// "Try with sample life": three weeks of fictional notes, already understood,
// written through the same paths as live capture so every screen has something real.
import type { CircleEntry, CircleStatus, ExtractOutput, Fragment, Source, WeaveOutput } from '@kizuna/shared';
import { resolveRelDay, zonedIso, zonedToUtc } from '@kizuna/shared';
import { db, defaultSettings, newId, readSettings, type MemberRow } from '../db.ts';
import { SAMPLE_CIRCLE_ID } from './circle.ts';
import { weekendRange } from './weekend.ts';
import { addDays, dayToDate, localDay } from './days.ts';
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
export interface SampleLife {
	myName: string;
	notes: SampleNote[];
	weave: WeaveOutput; // ids null, note_ids are note indexes as strings
	phones?: Record<string, string>;
	/** Optional: names to keep in the circle right away (default: all weave suggestions but one). */
	circle?: string[];
	/** Optional: people to offer as "keep in your circle?", with the reason shown. */
	suggest?: Record<string, string>;
	/** Optional: circle members as if they had replied, for the map (written on the phone only). */
	members?: SampleMember[];
}

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
		return { memberId: `sample-${String(i).padStart(5, '0')}`, entry, fetchedAt: at, ...(m.reply ? { reply: m.reply } : {}) };
	});
}

// Optional at build time: an empty glob just means the fixture isn't there yet.
const fixtures = import.meta.glob<SampleLife>('../../../../eval/fixtures/sample-life.json', { import: 'default' });

export async function fetchSampleLife(): Promise<SampleLife> {
	const load = Object.values(fixtures)[0];
	if (!load) throw new Error('Sample life is not available in this build.');
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
}

/** Loads a sample life (exported for tests; the UI calls loadSampleLife). */
export async function loadSampleLifeFrom(data: SampleLife): Promise<void> {
	const keep = await readSettings();
	await clearAll();
	const today = localDay();

	const fragIds: string[] = [];
	const order = data.notes.map((n, i) => ({ n, i })).sort((a, b) => b.n.daysAgo - a.n.daysAgo || a.n.time.localeCompare(b.n.time));
	for (const { n, i } of order) {
		const createdAt = dayToDate(addDays(today, -n.daysAgo), n.time || '09:00').toISOString();
		const f: Fragment = { id: newId(), text: n.text, createdAt, source: n.source ?? 'sample', status: 'new', tries: 0 };
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
		for (const m of sampleMembers(data.members ?? [], now)) {
			await db.members.put({ ...m, personId: matchPerson(people, m.entry.name)?.id ?? null, linkedBy: 'auto' });
		}
		await db.settings.put({
			...defaultSettings(),
			relayUrl: keep.relayUrl,
			icalUrl: keep.icalUrl,
			myName: data.myName,
			lastWeaveAt: new Date().toISOString(),
			notesSinceWeave: 0,
			// A local circle so the map glows without a server; sample life also shows the weekend card any day.
			...(data.members?.length
				? { circle: { id: SAMPLE_CIRCLE_ID, key: '', memberId: 'sample-me000', share: true, freeToday: true, paused: false }, forceWeekend: true }
				: {})
		});
	});
}

/** Loads three weeks of sample notes (already understood) so judges see everything at once. */
export async function loadSampleLife(): Promise<void> {
	await loadSampleLifeFrom(await fetchSampleLife());
}

export { clearAll };
