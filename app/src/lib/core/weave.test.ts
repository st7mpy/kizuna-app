import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WeaveOutput } from '@kizuna/shared';
import { db, defaultSettings } from '../db.ts';
import { applyWeave, runWeave, weaveDue } from './weave.ts';
import { mergePeople, removePerson } from './people.ts';
import { mkEvent, mkPerson, mkPrompt, mkThread, mockRelay, resetDb, setOffline } from './testing.ts';

const NOW = new Date(2026, 9, 26, 10, 0);
const wp = (p: Partial<WeaveOutput['people'][number]> & { name: string }): WeaveOutput['people'][number] => ({
	id: null, aliases: [], merge_ids: [], relation: 'unknown', closeness: 'close', suggest_circle: false, why: '', summary: '', ...p
});

beforeEach(async () => {
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(NOW);
	setOffline(false);
	await resetDb();
});
afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

describe('weaveDue', () => {
	it('is due at 10 notes, or after a day with 3+', () => {
		const recent = new Date(NOW.getTime() - 3600_000).toISOString();
		const old = new Date(NOW.getTime() - 25 * 3600_000).toISOString();
		expect(weaveDue({ notesSinceWeave: 10, lastWeaveAt: recent }, NOW)).toBe(true);
		expect(weaveDue({ notesSinceWeave: 9, lastWeaveAt: recent }, NOW)).toBe(false);
		expect(weaveDue({ notesSinceWeave: 3, lastWeaveAt: old }, NOW)).toBe(true);
		expect(weaveDue({ notesSinceWeave: 2, lastWeaveAt: old }, NOW)).toBe(false);
		expect(weaveDue({ notesSinceWeave: 3 }, NOW)).toBe(true);
	});
});

describe('applyWeave', () => {
	it('merges people, moving events, threads, notes and prompts to the kept one', async () => {
		await db.people.bulkAdd([
			mkPerson({ id: 'mum', name: 'Mum', relation: 'parent', aliases: ['mum'], mentions: 3, circle: 'in' }),
			mkPerson({ id: 'ma', name: 'Amma', relation: 'unknown', aliases: ['amma'], mentions: 2, phone: '9100' })
		]);
		await db.events.add(mkEvent({ id: 'e', what: 'checkup', personIds: ['ma'] }));
		await db.threads.add(mkThread({ id: 't', title: 'Gift for Ma', personIds: ['ma', 'mum'] }));
		await db.fragments.add({ id: 'f', text: 'x', createdAt: NOW.toISOString(), source: 'typed', status: 'done', tries: 0, personIds: ['ma'] });
		await db.prompts.add(mkPrompt({ id: 'pr', personId: 'ma', shownAt: NOW.toISOString() }));

		await applyWeave({
			people: [wp({ id: 'mum', name: 'Mum', aliases: ['mummy'], merge_ids: ['ma'], relation: 'parent', suggest_circle: true, summary: 'Has a lot on this week', why: 'Comes up every week' })],
			threads: []
		});
		const people = await db.people.toArray();
		expect(people).toHaveLength(1);
		const mum = people[0];
		expect(mum.aliases.sort()).toEqual(['amma', 'mum', 'mummy']);
		expect(mum).toMatchObject({ mentions: 5, phone: '9100', circle: 'in', summary: 'Has a lot on this week' });
		expect((await db.events.get('e'))!.personIds).toEqual(['mum']);
		expect((await db.threads.get('t'))!.personIds).toEqual(['mum']);
		expect((await db.fragments.get('f'))!.personIds).toEqual(['mum']);
		expect((await db.prompts.get('pr'))!.personId).toBe('mum');
	});

	it('suggests circle people unless the user already chose', async () => {
		await db.people.bulkAdd([
			mkPerson({ id: 'a', name: 'Kabir', circle: 'none' }),
			mkPerson({ id: 'b', name: 'Ishaan', circle: 'out' }),
			mkPerson({ id: 'c', name: 'Meera', circle: 'in' })
		]);
		await applyWeave({
			people: ['Kabir', 'Ishaan', 'Meera', 'Nani'].map((name) => wp({ name, suggest_circle: true, why: 'Comes up a lot' })),
			threads: []
		});
		const by = Object.fromEntries((await db.people.toArray()).map((p) => [p.name, p.circle]));
		expect(by).toEqual({ Kabir: 'suggested', Ishaan: 'out', Meera: 'in', Nani: 'suggested' });
	});

	it('upserts threads by title and resets the weave counter', async () => {
		await db.settings.put({ ...defaultSettings(), notesSinceWeave: 7 });
		await db.people.add(mkPerson({ id: 'r', name: 'Riya' }));
		await db.threads.add(mkThread({ id: 't', title: 'Papa birthday plan', kind: 'plan' }));
		await applyWeave(
			{
				people: [],
				threads: [
					{ title: 'papa birthday plan', kind: 'plan', people: ['Riya'], note_ids: ['0'], status: 'open' },
					{ title: 'Find a new flatmate', kind: 'errand', people: [], note_ids: ['1', '9'], status: 'open' },
					{ title: 'Old done thing', kind: 'idea', people: [], note_ids: [], status: 'done' }
				]
			},
			(id) => ({ '0': 'f0', '1': 'f1' })[id]
		);
		const threads = await db.threads.toArray();
		expect(threads).toHaveLength(2);
		expect(threads.find((t) => t.id === 't')).toMatchObject({ personIds: ['r'], fragmentIds: ['f0'] });
		expect(threads.find((t) => t.title === 'Find a new flatmate')!.fragmentIds).toEqual(['f1']);
		const s = (await db.settings.get('me'))!;
		expect(s.notesSinceWeave).toBe(0);
		expect(s.lastWeaveAt).toBe(NOW.toISOString());
	});
});

describe('runWeave', () => {
	it('sends recent notes and people, only when due unless forced', async () => {
		const relay = mockRelay((task, input) => {
			expect(task).toBe('weave');
			expect(input.today).toBe('2026-10-26');
			expect(input.notes.map((n: { text: string }) => n.text)).toEqual(['recent']);
			expect(input.people[0]).toMatchObject({ id: 'k', name: 'Kabir', circle: 'none' });
			return { people: [wp({ id: 'k', name: 'Kabir', suggest_circle: true })], threads: [] };
		});
		await db.people.add(mkPerson({ id: 'k', name: 'Kabir' }));
		await db.fragments.bulkAdd([
			{ id: 'old', text: 'old', createdAt: new Date(2026, 6, 1).toISOString(), source: 'typed', status: 'done', tries: 0 },
			{ id: 'new', text: 'recent', createdAt: new Date(2026, 9, 25).toISOString(), source: 'typed', status: 'done', tries: 0 }
		]);
		await db.settings.put({ ...defaultSettings(), notesSinceWeave: 1, lastWeaveAt: NOW.toISOString() });
		await runWeave();
		expect(relay.fn).not.toHaveBeenCalled();
		await runWeave(true);
		expect((await db.people.get('k'))!.circle).toBe('suggested');
	});

	it('stays quiet offline', async () => {
		setOffline(true);
		const relay = mockRelay(() => ({ people: [], threads: [] }));
		await db.fragments.add({ id: 'n', text: 'x', createdAt: NOW.toISOString(), source: 'typed', status: 'done', tries: 0 });
		await runWeave(true);
		expect(relay.fn).not.toHaveBeenCalled();
	});
});

describe('removePerson / mergePeople', () => {
	it('removes a person and events only about them', async () => {
		await db.people.bulkAdd([mkPerson({ id: 'a', name: 'A' }), mkPerson({ id: 'b', name: 'B' })]);
		await db.events.bulkAdd([mkEvent({ id: 'solo', what: 'x', personIds: ['a'] }), mkEvent({ id: 'both', what: 'y', personIds: ['a', 'b'] })]);
		await removePerson('a');
		expect(await db.events.get('solo')).toBeUndefined();
		expect((await db.events.get('both'))!.personIds).toEqual(['b']);
		expect(await db.people.count()).toBe(1);
	});

	it('merging into itself does nothing', async () => {
		await db.people.add(mkPerson({ id: 'a', name: 'A' }));
		await mergePeople('a', 'a');
		expect(await db.people.count()).toBe(1);
	});
});
