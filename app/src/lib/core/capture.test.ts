import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExtractOutput } from '@kizuna/shared';
import { db } from '../db.ts';
import { captureConfig, processPending, saveFragment } from './capture.ts';
import { matchPerson } from './people.ts';
import { mkPerson, mockRelay, resetDb, setOffline } from './testing.ts';

const NOW = new Date(2026, 9, 26, 10, 0); // Monday

const empty = (p: Partial<ExtractOutput> = {}): ExtractOutput => ({
	language: 'mixed',
	sensitive: false,
	people: [],
	events: [],
	promises: [],
	threads: [],
	...p
});

async function idle() {
	await processPending();
}

beforeEach(async () => {
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(NOW);
	captureConfig.sleep = async () => {};
	setOffline(false);
	await resetDb();
});
afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

describe('saveFragment + processPending', () => {
	it('saves at once and understands the note in the background', async () => {
		const relay = mockRelay((task, input) => {
			expect(task).toBe('extract');
			expect(input.today).toBe('2026-10-26');
			expect(input.weekday).toBe('Monday');
			return empty({
				sensitive: true,
				people: [
					{ name: 'Mum', relation: 'parent' },
					{ name: 'Kabir', relation: 'friend' }
				],
				events: [
					{ what: 'knee appointment', kind: 'appointment', people: ['Mum'], date: '2026-10-28', time: null, date_text: 'Thursday' },
					{ what: 'started new job', kind: 'milestone', people: ['Kabir'], date: '2026-10-26', time: null, date_text: null }
				],
				promises: [{ what: 'Call Kabir', person: 'Kabir', date_text: null }],
				threads: [{ title: 'Papa birthday plan', kind: 'plan', people: ['Riya', 'Papa'] }]
			});
		});
		const f = await saveFragment('  Mum ka knee appointment Thursday hai, Kabir ne naya job join kiya  ', 'voice');
		expect(f.status).toBe('new');
		expect(f.text).toBe('Mum ka knee appointment Thursday hai, Kabir ne naya job join kiya');
		await idle();

		const saved = (await db.fragments.get(f.id))!;
		expect(saved.status).toBe('done');
		expect(saved.sensitive).toBe(true);
		expect(saved.language).toBe('mixed');
		expect(relay.calls[0].headers['x-kizuna-device']).toMatch(/[0-9a-f-]{36}/);

		const people = await db.people.toArray();
		expect(people.map((p) => p.name).sort()).toEqual(['Kabir', 'Mum', 'Papa', 'Riya']);
		expect(saved.personIds).toHaveLength(4);
		const mum = people.find((p) => p.name === 'Mum')!;
		expect(mum).toMatchObject({ relation: 'parent', mentions: 1, circle: 'none', lastMentionedAt: f.createdAt });

		// The date guard moves "Thursday" to the real Thursday
		const knee = (await db.events.toArray()).find((e) => e.what === 'knee appointment')!;
		expect(knee.day).toBe('2026-10-29');
		expect(knee.personIds).toEqual([mum.id]);

		const threads = await db.threads.toArray();
		expect(threads.find((t) => t.kind === 'promise')).toMatchObject({ title: 'Call Kabir', status: 'open' });
		expect(threads.find((t) => t.kind === 'plan')!.personIds).toHaveLength(2);
		expect((await db.settings.get('me'))!.notesSinceWeave).toBe(1);
	});

	it('treats Ma, Mummy and Mum as one parent, and merges threads by title', async () => {
		const outs = [
			empty({ people: [{ name: 'Mum', relation: 'parent' }], threads: [{ title: 'Goa trip', kind: 'plan', people: [] }] }),
			empty({ people: [{ name: 'Mummy', relation: 'parent' }], threads: [{ title: 'goa  trip', kind: 'plan', people: ['Ishaan'] }] }),
			empty({ people: [{ name: 'maa', relation: 'unknown' }, { name: 'Papa', relation: 'parent' }, { name: 'dad', relation: 'parent' }] })
		];
		mockRelay(() => outs.shift());
		await saveFragment('one', 'typed');
		await idle();
		await saveFragment('two', 'typed');
		await idle();
		await saveFragment('three', 'typed');
		await idle();
		const people = await db.people.toArray();
		expect(people.map((p) => p.name).sort()).toEqual(['Ishaan', 'Mum', 'Papa']);
		const mum = people.find((p) => p.name === 'Mum')!;
		expect(mum.aliases.sort()).toEqual(['maa', 'mum', 'mummy']);
		expect(mum.mentions).toBe(3);
		expect(people.find((p) => p.name === 'Papa')!.aliases.sort()).toEqual(['dad', 'papa']);
		const threads = await db.threads.toArray();
		expect(threads).toHaveLength(1);
		expect(threads[0].fragmentIds).toHaveLength(2);
	});

	it('does not merge a friend called Ma with a parent', () => {
		const people = [mkPerson({ id: 'm', name: 'Mum', relation: 'parent' })];
		expect(matchPerson(people, 'Mummy', 'parent')?.id).toBe('m');
		expect(matchPerson(people, 'Mummy', 'friend')).toBeUndefined();
		expect(matchPerson(people, 'Mum ji', 'unknown')?.id).toBe('m');
	});

	it('retries up to three times, then marks the note failed', async () => {
		const relay = mockRelay(() => {
			throw new Error('boom');
		});
		const f = await saveFragment('hello', 'typed');
		await idle();
		expect(relay.tasks()).toEqual(['extract', 'extract', 'extract']);
		expect(await db.fragments.get(f.id)).toMatchObject({ status: 'failed', tries: 3 });
	});

	it('succeeds on a later try', async () => {
		let n = 0;
		mockRelay(() => {
			if (n++ === 0) throw new Error('flaky');
			return empty();
		});
		const f = await saveFragment('hello', 'typed');
		await idle();
		expect(await db.fragments.get(f.id)).toMatchObject({ status: 'done', tries: 1 });
	});

	it('leaves notes new while offline and picks them up later', async () => {
		setOffline(true);
		const relay = mockRelay(() => empty());
		const f = await saveFragment('offline note', 'typed');
		await idle();
		expect(relay.fn).not.toHaveBeenCalled();
		expect(await db.fragments.get(f.id)).toMatchObject({ status: 'new', tries: 0 });
		setOffline(false);
		await processPending();
		expect((await db.fragments.get(f.id))!.status).toBe('done');
	});

	it('does not count a try when the relay cannot be reached', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => {
			throw new TypeError('fetch failed');
		}));
		const f = await saveFragment('x', 'typed');
		await idle();
		expect(await db.fragments.get(f.id)).toMatchObject({ status: 'new', tries: 0 });
	});

	it('runs the weave once 10 notes are understood', async () => {
		const relay = mockRelay((task) => (task === 'weave' ? { people: [], threads: [] } : empty()));
		setOffline(true);
		for (let i = 0; i < 10; i++) await saveFragment(`note ${i}`, 'typed');
		setOffline(false);
		await processPending();
		expect(relay.tasks().filter((t) => t === 'weave')).toHaveLength(1);
		const s = (await db.settings.get('me'))!;
		expect(s.notesSinceWeave).toBe(0);
		expect(s.lastWeaveAt).toBe(NOW.toISOString());
	});

	it('runs the weave after a day with 3+ notes, not before', async () => {
		const relay = mockRelay((task) => (task === 'weave' ? { people: [], threads: [] } : empty()));
		await db.settings.put({ ...(await import('../db.ts')).defaultSettings(), lastWeaveAt: new Date(2026, 9, 26, 9).toISOString(), notesSinceWeave: 0 });
		for (let i = 0; i < 3; i++) {
			await saveFragment(`n${i}`, 'typed');
			await idle();
		}
		expect(relay.tasks()).not.toContain('weave');
		vi.setSystemTime(new Date(2026, 9, 27, 10));
		await saveFragment('n4', 'typed');
		await idle();
		expect(relay.tasks()).toContain('weave');
	});
});
