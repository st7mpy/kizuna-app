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
export const SAMPLE_VERSION = 2;
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

/** Pure: sample members as cached entries, windows on the coming weekend, status good for 12 h. */
export function sampleMembers(list: SampleMember[], now: Date): Omit<MemberRow, 'personId'>[] {
	const range = weekendRange(now, true)!;
	const days = { sat: range.saturday, sun: addDays(range.saturday, 1) };
	const at = now.toISOString();
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
			status: m.status,
			statusUntil: m.status ? new Date(now.getTime() + 12 * 3600_000).toISOString() : null,
			windows,
			quietStart: '22:00',
			quietEnd: '08:00',
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
		for (const m of sampleMembers(data.members ?? [], now)) {
			const personId = matchPerson(people, m.entry.name)?.id ?? null;
			// Their windows came from the app last week; nothing new since they were asked.
			const entry = personId && waiting.has(personId) ? { ...m.entry, updatedAt: before } : m.entry;
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
	if (!staleSample(s, fragments)) return false;
	const key = (SAMPLES.find((x) => x.key === s?.sample?.key)?.key ?? 'abroad') as SampleKey;
	await loadSample(key);
	return true;
}

/** The default sample family. */
export async function loadSampleLife(): Promise<void> {
	await loadSample('abroad');
}

export { clearAll };
