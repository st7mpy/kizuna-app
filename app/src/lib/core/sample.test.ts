import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db, defaultSettings } from '../db.ts';
import { exportNotes, deleteEverything, notesMarkdown } from './data.ts';
import { fetchSampleLife, loadSampleLifeFrom, resolveRel, type SampleLife } from './sample.ts';
import { deviceId } from './relay.ts';
import { todayCards } from './today.ts';
import { resetDb, setOffline } from './testing.ts';

const NOW = new Date(2026, 9, 26, 10, 0); // Monday

const tiny: SampleLife = {
	myName: 'Aarav',
	notes: [
		{
			daysAgo: 20, time: '08:40', source: 'voice',
			text: 'Nani se baat hui, Sunday ko phir call karna hai',
			extract: { language: 'mixed', sensitive: false, people: [{ name: 'Nani', relation: 'family' }], events: [], promises: [], threads: [] }
		},
		{
			daysAgo: 2, time: '21:10', source: 'voice',
			text: 'Mum ka knee appointment Thursday hai, Kabir ne naya job join kiya, should call him',
			extract: {
				language: 'mixed', sensitive: true,
				people: [{ name: 'Mum', relation: 'parent' }, { name: 'Kabir', relation: 'friend' }],
				events: [
					{ what: 'knee appointment', kind: 'appointment', people: ['Mum'], date: 'rel:3', time: null, date_text: 'Thursday' },
					{ what: 'started new job', kind: 'milestone', people: ['Kabir'], date: 'rel:-1', time: null, date_text: null }
				],
				promises: [{ what: 'Call Kabir', person: 'Kabir', date_text: null }],
				threads: []
			}
		},
		{
			daysAgo: 1, time: '19:00', source: 'typed',
			text: 'Mummy said the appointment moved. Goa trip idea with Ishaan',
			extract: {
				language: 'en', sensitive: true,
				people: [{ name: 'Mummy', relation: 'parent' }, { name: 'Ishaan', relation: 'friend' }],
				events: [],
				promises: [],
				threads: [{ title: 'Goa trip', kind: 'plan', people: ['Ishaan'] }]
			}
		}
	],
	weave: {
		people: [
			{ id: null, name: 'Mum', aliases: ['mum', 'mummy', 'ma'], merge_ids: [], relation: 'parent', closeness: 'inner', suggest_circle: true, why: 'Family, comes up most', summary: 'Busy week' },
			{ id: null, name: 'Kabir', aliases: ['kabir'], merge_ids: [], relation: 'friend', closeness: 'close', suggest_circle: true, why: 'College friend, new job', summary: 'New job since Sunday' },
			{ id: null, name: 'Nani', aliases: ['nani'], merge_ids: [], relation: 'family', closeness: 'inner', suggest_circle: true, why: 'Sunday calls', summary: 'Sunday calls' },
			{ id: null, name: 'Ishaan', aliases: ['ishaan'], merge_ids: [], relation: 'friend', closeness: 'close', suggest_circle: true, why: 'Flatmate, moving out', summary: 'Moving out soon' }
		],
		threads: [{ title: 'Goa trip', kind: 'plan', people: ['Ishaan'], note_ids: ['2'], status: 'open' }]
	},
	phones: { Kabir: '919800000001' }
};

beforeEach(async () => {
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(NOW);
	setOffline(true);
	await resetDb();
});
afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

describe('sample life', () => {
	it('resolves rel:N days', () => {
		expect(resolveRel('rel:3', '2026-10-26')).toBe('2026-10-29');
		expect(resolveRel('rel:-2', '2026-10-26')).toBe('2026-10-24');
		expect(resolveRel(null, '2026-10-26')).toBeNull();
		expect(resolveRel('2026-12-01', '2026-10-26')).toBe('2026-12-01');
	});

	it('loads notes, people, events, threads and settings, ready for Today', async () => {
		await db.fragments.add({ id: 'old', text: 'my real note', createdAt: NOW.toISOString(), source: 'typed', status: 'done', tries: 0 });
		await db.settings.put({ ...defaultSettings(), relayUrl: 'http://localhost:8787' });
		await loadSampleLifeFrom(tiny);

		const frags = await db.fragments.toArray();
		expect(frags).toHaveLength(3);
		expect(frags.every((f) => f.status === 'done')).toBe(true);
		const first = frags.find((f) => f.text.startsWith('Nani'))!;
		expect(new Date(first.createdAt)).toEqual(new Date(2026, 9, 6, 8, 40));

		const people = await db.people.toArray();
		expect(people.map((p) => p.name).sort()).toEqual(['Ishaan', 'Kabir', 'Mum', 'Nani']);
		const mum = people.find((p) => p.name === 'Mum')!;
		expect(mum.aliases).toEqual(expect.arrayContaining(['mum', 'mummy', 'ma']));
		expect(mum.mentions).toBe(2);
		const kabir = people.find((p) => p.name === 'Kabir')!;
		expect(kabir).toMatchObject({ phone: '919800000001', circle: 'in', summary: 'New job since Sunday' });
		expect(people.find((p) => p.name === 'Ishaan')!.circle).toBe('suggested');

		const knee = (await db.events.toArray()).find((e) => e.what === 'knee appointment')!;
		expect(knee).toMatchObject({ day: '2026-10-29', dateConfidence: 'sure', personIds: [mum.id] });
		const goa = (await db.threads.toArray()).find((t) => t.title === 'Goa trip')!;
		expect(goa.fragmentIds).toEqual([frags.find((f) => f.text.startsWith('Mummy'))!.id]);

		const s = (await db.settings.get('me'))!;
		expect(s).toMatchObject({ myName: 'Aarav', relayUrl: 'http://localhost:8787', notesSinceWeave: 0 });

		const cards = await todayCards();
		expect(cards.map((c) => c.title)).toEqual(['Kabir', 'Mum', 'Nani']);
	});

	it('loads the real fixture so Today has cards at once', async () => {
		const life = await fetchSampleLife();
		vi.setSystemTime(new Date(2026, 9, 26, 12, 0));
		await loadSampleLifeFrom(life);
		expect(await db.fragments.count()).toBe(life.notes.length);
		const people = await db.people.toArray();
		expect(people.filter((p) => p.circle === 'in').length).toBeGreaterThanOrEqual(3);
		expect(people.some((p) => p.circle === 'suggested')).toBe(true);
		expect(people.find((p) => p.name === 'Kabir')).toMatchObject({ circle: 'in', phone: '919800000001' });
		// one person per kinship group (Mum/Mummy/Ma are one)
		expect(people.filter((p) => p.relation === 'parent').length).toBeLessThanOrEqual(2);
		const { setRoom } = await import('./settings.ts');
		await setRoom('lots');
		const cards = await todayCards();
		expect(cards.filter((c) => c.kind === 'person').length).toBeGreaterThanOrEqual(3);
		expect(cards.map((c) => c.kind)).toEqual(['person', 'person', 'person', 'suggest_circle', 'thread']);
		expect(cards.map((c) => c.reason).join(' ')).not.toMatch(/\d+ days?/);
	});

	it('exports notes as markdown by day', async () => {
		await loadSampleLifeFrom(tiny);
		const blob = await exportNotes();
		expect(blob.type).toBe('text/markdown;charset=utf-8');
		const md = await blob.text();
		expect(md).toMatch(/^# Kizuna notes\n\n## 2026-10-06\n\n- 08:40 Nani se baat hui/);
		expect(md.indexOf('## 2026-10-24')).toBeLessThan(md.indexOf('## 2026-10-25'));
		expect(notesMarkdown([])).toBe('# Kizuna notes\n\n');
	});

	it('delete everything clears all tables and the device id', async () => {
		const store = new Map<string, string>();
		vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k) });
		const id = deviceId();
		await loadSampleLifeFrom(tiny);
		await deleteEverything();
		for (const t of db.tables) expect(await t.count()).toBe(0);
		expect(deviceId()).not.toBe(id);
	});
});
