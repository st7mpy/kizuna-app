// "Try it with a sample family": three weeks of fictional notes, already understood,
// written through the same paths as live capture so every screen has something real.
// Two families: a busy working family with one child studying abroad, and a big family across the USA.
import type { CircleEntry, CircleStatus, ExtractOutput, Fragment, Settings, Source, WeaveOutput } from '@kizuna/shared';
import { resolveRelDay, zonedIso, zonedToUtc } from '@kizuna/shared';
import { db, defaultSettings, newId, readSettings, type MemberRow } from '../db.ts';
import { SAMPLE_CIRCLE_ID } from './circle.ts';
import { weekendRange } from './weekend.ts';
import { addDays, dayToDate, localDay, setHomeZone } from './days.ts';
import { applyExtract } from './capture.ts';
import { matchPerson } from './people.ts';
import { applyWeave } from './weave.ts';
import { clearBusyCache } from './time.ts';
import { quietAt } from './zones.ts';

export interface SampleNote {
	daysAgo: number;
	time: string; // 'HH:MM'
	source?: Source;
	text: string;
	extract: ExtractOutput; // dates written 'rel:N'
}
export type SampleKey = 'abroad' | 'usa';

/** The samples a visitor can pick, default first. */
export const SAMPLES: { key: SampleKey; label: string; blurb: string }[] = [
	{ key: 'abroad', label: 'A busy family, one abroad', blurb: 'Mom, Dad and Maya work long weeks. Leo is studying in Melbourne, a day ahead.' },
	{ key: 'usa', label: 'One big family across the USA', blurb: 'Grandparents in Phoenix, aunts, uncles and cousins from New York to Honolulu.' }
];

export interface SampleLife {
	/** Which sample this is (the fixtures carry it). */
	id?: SampleKey;
	label?: string;
	blurb?: string;
	myName: string;
	/** Where "you" live in this sample. Planning and "your time" use it, wherever the visitor is. */
	homeTz?: string;
	notes: SampleNote[];
	weave: WeaveOutput; // ids null, note_ids are note indexes as strings
	phones?: Record<string, string>;
	/** Optional: names to keep in the circle right away (default: all weave suggestions but one). */
	circle?: string[];
	/** Optional: people to offer as "keep in your circle?", with the reason shown. */
	suggest?: Record<string, string>;
	/** Optional: circle members as if they had replied, for the map (written on the phone only). */
	members?: SampleMember[];
	/** Optional: people asked about this weekend who haven't answered yet (their entry is from before the ask). */
	waiting?: string[];
}

/** Goes up whenever the samples change, so a visitor with an older sample gets the current one. */
export const SAMPLE_VERSION = 3;
/** The two oldest samples: 40 and 41 notes, written before samples carried a version. */
const OLD_SAMPLE_MAX_NOTES = 41;

export interface SampleMember {
	name: string;
	tz: string;
	status: CircleStatus | null;
	via?: 'app' | 'page';
	reply?: string;
	/** Times on the coming weekend, in the member's own zone. */
	windows: { day: 'sat' | 'sun'; start: string; end: string }[];
}

const mins = (hhmm: string) => {
	const [h, m] = hhmm.split(':').map(Number);
	return h * 60 + (m || 0);
};

const QUIET_START = '22:00';
const QUIET_END = '08:00';

/**
 * Pure: who is open or maybe right now. Nobody glows in their own quiet hours; if that leaves
 * nobody open, the first person who is awake (and answered) is open instead, so the map always
 * shows what a glow means.
 */
export function sampleStatuses(list: SampleMember[], now: Date, waiting: Set<string> = new Set()): (CircleStatus | null)[] {
	const ms = now.getTime();
	const awake = list.map((m) => !quietAt(ms, m.tz, QUIET_START, QUIET_END));
	const out = list.map((m, i) => (awake[i] ? m.status : null));
	if (!out.includes('free')) {
		const i = list.findIndex((m, k) => awake[k] && !waiting.has(m.name) && out[k] !== 'maybe');
		if (i >= 0) out[i] = 'free';
	}
	return out;
}

/**
 * Pure: sample members as cached entries, windows on the coming weekend, status good for 12 h.
 * Always relative to `now`, so the sample can be re-based on any later day (refreshSampleMembers).
 */
export function sampleMembers(list: SampleMember[], now: Date, waiting: Set<string> = new Set()): Omit<MemberRow, 'personId'>[] {
	const range = weekendRange(now, true)!;
	const days = { sat: range.saturday, sun: addDays(range.saturday, 1) };
	const at = now.toISOString();
	const statuses = sampleStatuses(list, now, waiting);
	return list.map((m, i) => {
		const windows = m.windows
			.map((w) => {
				const s = zonedToUtc(days[w.day], mins(w.start), m.tz);
				const e = zonedToUtc(days[w.day], mins(w.end), m.tz);
				return s != null && e != null && e > now.getTime() ? { start: zonedIso(Math.max(s, now.getTime()), m.tz), end: zonedIso(e, m.tz) } : null;
			})
			.filter((w): w is { start: string; end: string } => !!w);
		const entry: CircleEntry = {
			v: 1,
			name: m.name,
			tz: m.tz,
			status: statuses[i],
			statusUntil: statuses[i] ? new Date(now.getTime() + 12 * 3600_000).toISOString() : null,
			windows,
			quietStart: QUIET_START,
			quietEnd: QUIET_END,
			via: m.via ?? 'app',
			updatedAt: at
		};
		// A family-page answer came in a little while ago, so Today can say so.
		const answeredAt = m.via === 'page' ? new Date(now.getTime() - 2 * 3600_000).toISOString() : undefined;
		return {
			memberId: `sample-${String(i).padStart(5, '0')}`,
			entry: answeredAt ? { ...entry, updatedAt: answeredAt } : entry,
			fetchedAt: at,
			...(m.reply ? { reply: m.reply } : {}),
			...(answeredAt ? { answeredAt, answerSeen: false } : {})
		};
	});
}

// Optional at build time: an empty glob just means the fixtures aren't there yet.
const fixtures = import.meta.glob<SampleLife>('../../../../eval/fixtures/sample-*.json', { import: 'default' });

export async function fetchSampleLife(key: SampleKey = 'abroad'): Promise<SampleLife> {
	const load = Object.entries(fixtures).find(([path]) => path.endsWith(`/sample-${key}.json`))?.[1];
	if (!load) throw new Error('This sample is not available in this build.');
	return load();
}

/** 'rel:3' -> the day three days after `today`. Anything else passes through. */
export function resolveRel(date: string | null, today: string): string | null {
	return date ? resolveRelDay(date.trim(), today) : null;
}

export function resolveExtract(x: ExtractOutput, today: string): ExtractOutput {
	return { ...x, events: (x.events ?? []).map((e) => ({ ...e, date: resolveRel(e.date, today) })) };
}

async function clearAll(): Promise<void> {
	await db.transaction('rw', db.tables, async () => {
		await Promise.all(db.tables.map((t) => t.clear()));
	});
	clearBusyCache();
	setHomeZone(null);
}

/** Loads a sample life (exported for tests; the UI calls loadSample). */
export async function loadSampleLifeFrom(data: SampleLife): Promise<void> {
	const keep = await readSettings();
	await clearAll();
	// Save the home city first: everything below reads settings and must see the same zone.
	if (data.homeTz) await db.settings.put({ ...defaultSettings(), homeTz: data.homeTz });
	setHomeZone(data.homeTz);
	const today = localDay();

	const fragIds: string[] = [];
	const order = data.notes.map((n, i) => ({ n, i })).sort((a, b) => b.n.daysAgo - a.n.daysAgo || a.n.time.localeCompare(b.n.time));
	for (const { n, i } of order) {
		const createdAt = dayToDate(addDays(today, -n.daysAgo), n.time || '09:00').toISOString();
		// Marked as sample notes, so a newer sample can replace them while the visitor has added nothing.
		const f: Fragment = { id: newId(), text: n.text, createdAt, source: 'sample', status: 'new', tries: 0 };
		fragIds[i] = f.id;
		await db.fragments.add(f);
		await applyExtract(f, resolveExtract(n.extract, today), { trustDates: true });
	}

	await applyWeave(
		{ ...data.weave, people: data.weave.people.map((p) => ({ ...p, id: null, merge_ids: [] })) },
		(id) => fragIds[Number(id)]
	);

	await db.transaction('rw', [db.people, db.settings, db.members], async () => {
		const people = await db.people.toArray();
		for (const [name, phone] of Object.entries(data.phones ?? {})) {
			const p = matchPerson(people, name);
			if (p) p.phone = phone.replace(/\D/g, '');
		}
		// Put people in the circle so Today has cards at once; leave one suggestion to show "Keep?".
		const suggested = data.weave.people.filter((p) => p.suggest_circle).map((p) => matchPerson(people, p.name)).filter((p) => !!p);
		const keepNames = data.circle ?? suggested.slice(0, -1).map((p) => p.name);
		for (const name of keepNames) {
			const p = matchPerson(people, name);
			if (p) p.circle = 'in';
		}
		for (const [name, why] of Object.entries(data.suggest ?? {})) {
			const p = matchPerson(people, name);
			if (p && p.circle !== 'in') Object.assign(p, { circle: 'suggested', why });
		}
		for (const p of people) await db.people.put(p);
		// The map: members as if they had replied (no network), linked to their people.
		const now = new Date();
		const waiting = new Set((data.waiting ?? []).map((n) => matchPerson(people, n)?.id).filter((id): id is string => !!id));
		const asked = new Date(now.getTime() - 2 * 86_400_000).toISOString();
		const before = new Date(now.getTime() - 3 * 86_400_000).toISOString();
		for (const m of sampleMembers(data.members ?? [], now, new Set(data.waiting ?? []))) {
			const personId = matchPerson(people, m.entry.name)?.id ?? null;
			// They haven't answered since they were asked: nothing shared for this weekend yet, so the
			// weekend plan can't count them as free while Today says they haven't answered.
			const entry =
				personId && waiting.has(personId)
					? { ...m.entry, windows: [], status: null, statusUntil: null, updatedAt: before }
					: m.entry;
			await db.members.put({ ...m, entry, personId, linkedBy: 'auto' });
		}
		// Everyone was asked about this weekend two days ago; the waiting ones haven't answered yet.
		if (data.members?.length) {
			for (const p of people) if (p.circle === 'in') await db.people.update(p.id, { invitedAt: asked });
		}
		await db.settings.put({
			...defaultSettings(),
			relayUrl: keep.relayUrl,
			icalUrl: keep.icalUrl,
			myName: data.myName,
			...(data.homeTz ? { homeTz: data.homeTz } : {}),
			lastWeaveAt: new Date().toISOString(),
			notesSinceWeave: 0,
			sample: { key: data.id ?? 'abroad', version: SAMPLE_VERSION },
			// A local circle so the map glows without a server; sample life also shows the weekend card any day.
			...(data.members?.length
				? { circle: { id: SAMPLE_CIRCLE_ID, key: '', memberId: 'sample-me000', share: true, freeToday: true, paused: false }, forceWeekend: true }
				: {})
		});
	});
}

/** Loads one sample family's three weeks of notes (already understood), replacing what is on the phone. */
export async function loadSample(key: SampleKey = 'abroad'): Promise<void> {
	await loadSampleLifeFrom(await fetchSampleLife(key));
}

/**
 * Pure: true when the phone holds an older sample (or one from before samples had a version) and the
 * visitor added nothing of their own, so the current sample can quietly replace it.
 */
export function staleSample(
	s: Pick<Settings, 'sample' | 'circle' | 'myName' | 'notesSinceWeave'> | undefined,
	fragments: Pick<Fragment, 'source'>[]
): boolean {
	if (!s || !fragments.length) return false;
	if (s.sample) return s.sample.version < SAMPLE_VERSION && fragments.every((f) => f.source === 'sample');
	// Before versions: the sample set up a local circle (or was Aarav's), and no note came after it.
	const looksSample = s.circle?.id === SAMPLE_CIRCLE_ID || s.myName === 'Aarav';
	return looksSample && (s.notesSinceWeave ?? 0) === 0 && fragments.length <= OLD_SAMPLE_MAX_NOTES;
}

/** On startup: replaces an outdated sample with the current one. Leaves anything of the user's alone. */
export async function refreshStaleSample(): Promise<boolean> {
	const [s, fragments] = await Promise.all([db.settings.get('me'), db.fragments.toArray()]);
	if (!staleSample(s, fragments)) {
		await refreshSampleMembers().catch(() => false);
		return false;
	}
	const key = (SAMPLES.find((x) => x.key === s?.sample?.key)?.key ?? 'abroad') as SampleKey;
	await loadSample(key);
	return true;
}

const REBASE_MS = 20 * 60_000;
let rebasing: Promise<boolean> | null = null;

/**
 * The sample's family answers are written relative to the moment it was loaded. On a later visit
 * (or a tab left open) this re-bases them on now: who is open, and their windows on the coming
 * weekend, so a sample loaded days ago still glows and still has a weekend to plan.
 * Keeps links to people and what Today already showed. Does nothing outside the sample.
 */
export function refreshSampleMembers(now = new Date()): Promise<boolean> {
	rebasing ??= (async () => {
		try {
			const s = await db.settings.get('me');
			if (s?.circle?.id !== SAMPLE_CIRCLE_ID) return false;
			const rows = (await db.members.toArray()).filter((m) => m.memberId.startsWith('sample-'));
			if (!rows.length) return false;
			const ms = now.getTime();
			if (rows.every((r) => ms - Date.parse(r.fetchedAt) < REBASE_MS && Date.parse(r.fetchedAt) <= ms)) return false;
			const data = await fetchSampleLife((SAMPLES.find((x) => x.key === s.sample?.key)?.key ?? 'abroad') as SampleKey);
			const old = new Map(rows.map((r) => [r.memberId, r]));
			// Waiting: their entry is from before they were asked (written a day or more before it was fetched).
			const isWaiting = (r: MemberRow) => Date.parse(r.fetchedAt) - Date.parse(r.entry.updatedAt) > 86_400_000;
			const waiting = new Set(rows.filter(isWaiting).map((r) => r.entry.name));
			const fresh = sampleMembers(data.members ?? [], now, waiting);
			const asked = new Date(ms - 2 * 86_400_000).toISOString();
			const before = new Date(ms - 3 * 86_400_000).toISOString();
			await db.transaction('rw', [db.members, db.people], async () => {
				for (const m of fresh) {
					const o = old.get(m.memberId);
					if (!o) continue; // the visitor unlinked or it went away: leave it
					const entry = waiting.has(m.entry.name) ? { ...m.entry, windows: [], status: null, statusUntil: null, updatedAt: before } : m.entry;
					await db.members.put({
						...o,
						entry,
						fetchedAt: m.fetchedAt,
						...(o.answeredAt ? {} : m.answeredAt ? { answeredAt: m.answeredAt, answerSeen: false } : {})
					});
				}
				// "Asked two days ago" moves along too, so the waiting ones still read as waiting.
				const people = await db.people.toArray();
				for (const p of people) if (p.circle === 'in' && p.invitedAt) await db.people.update(p.id, { invitedAt: asked });
			});
			return true;
		} finally {
			rebasing = null;
		}
	})();
	return rebasing;
}

/** The default sample family. */
export async function loadSampleLife(): Promise<void> {
	await loadSample('abroad');
}

export { clearAll };
