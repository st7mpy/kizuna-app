// "Try with sample life": three weeks of fictional notes, already understood,
// written through the same paths as live capture so every screen has something real.
import type { ExtractOutput, Fragment, Source, WeaveOutput } from '@kizuna/shared';
import { resolveRelDay } from '@kizuna/shared';
import { db, defaultSettings, newId, readSettings } from '../db.ts';
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
	await db.transaction('rw', [db.fragments, db.people, db.events, db.threads, db.prompts, db.settings], async () => {
		await Promise.all([db.fragments.clear(), db.people.clear(), db.events.clear(), db.threads.clear(), db.prompts.clear(), db.settings.clear()]);
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

	await db.transaction('rw', [db.people, db.settings], async () => {
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
		for (const p of people) await db.people.put(p);
		await db.settings.put({
			...defaultSettings(),
			relayUrl: keep.relayUrl,
			icalUrl: keep.icalUrl,
			myName: data.myName,
			lastWeaveAt: new Date().toISOString(),
			notesSinceWeave: 0
		});
	});
}

/** Loads three weeks of sample notes (already understood) so judges see everything at once. */
export async function loadSampleLife(): Promise<void> {
	await loadSampleLifeFrom(await fetchSampleLife());
}

export { clearAll };
