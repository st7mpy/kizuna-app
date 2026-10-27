import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExtractOutput } from '@kizuna/shared';
import { db } from '../db.ts';
import { FAILED_RETRY_MS, ONLINE_SETTLE_MS, noteThought, processPending, requeueFailed, retryFragment, saveFragment } from './capture.ts';
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
	gift_hints: [],
	...p
});

async function idle() {
	await processPending();
}

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

	it('backs off over minutes, then marks the note failed', async () => {
		const relay = mockRelay(() => {
			throw new Error('boom');
		});
		const f = await saveFragment('hello', 'typed');
		await idle();
		expect(await db.fragments.get(f.id)).toMatchObject({ status: 'new', tries: 1 });
		// Not again before the wait is over
		vi.setSystemTime(NOW.getTime() + 10_000);
		await processPending();
		expect(relay.tasks()).toEqual(['extract']);
		vi.setSystemTime(NOW.getTime() + 31_000);
		await processPending();
		expect(await db.fragments.get(f.id)).toMatchObject({ status: 'new', tries: 2 });
		vi.setSystemTime(NOW.getTime() + 31_000 + 121_000);
		await processPending();
		expect(relay.tasks()).toEqual(['extract', 'extract', 'extract']);
		expect(await db.fragments.get(f.id)).toMatchObject({ status: 'failed', tries: 3 });
	});

	it('tries failed notes again on app open, once a day', async () => {
		let fail = true;
		const relay = mockRelay(() => {
			if (fail) throw new Error('boom');
			return empty();
		});
		const f = await saveFragment('hello', 'typed');
		await idle();
		await db.fragments.update(f.id, { status: 'failed', tries: 3, nextTryAt: new Date(NOW.getTime() + FAILED_RETRY_MS).toISOString() });
		expect(await requeueFailed()).toBe(0);
		vi.setSystemTime(NOW.getTime() + FAILED_RETRY_MS + 1);
		fail = false;
		expect(await requeueFailed()).toBe(1);
		await processPending();
		expect(await db.fragments.get(f.id)).toMatchObject({ status: 'done' });
		expect(relay.tasks().length).toBe(2);
	});

	it('does not count a try when rate limited or timed out', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: false, error: 'rate_limited' }), { status: 429 })));
		const f = await saveFragment('x', 'typed');
		await idle();
		expect(await db.fragments.get(f.id)).toMatchObject({ status: 'new', tries: 0 });
		expect((await db.fragments.get(f.id))!.nextTryAt).toBeUndefined();
	});

	it('succeeds on a later try', async () => {
		let n = 0;
		mockRelay(() => {
			if (n++ === 0) throw new Error('flaky');
			return empty();
		});
		const f = await saveFragment('hello', 'typed');
		await idle();
		vi.setSystemTime(NOW.getTime() + 31_000);
		await processPending();
		expect(await db.fragments.get(f.id)).toMatchObject({ status: 'done', tries: 1 });
	});

	it('retryFragment clears the wait', async () => {
		mockRelay(() => empty());
		const f = await saveFragment('hello', 'typed');
		await idle();
		await db.fragments.update(f.id, { status: 'failed', tries: 3, nextTryAt: new Date(NOW.getTime() + FAILED_RETRY_MS).toISOString() });
		await retryFragment(f.id);
		await idle();
		expect(await db.fragments.get(f.id)).toMatchObject({ status: 'done' });
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

	it('keeps gift hints (matched by alias) and turns dated birthdays into occasions', async () => {
		await db.people.add(mkPerson({ id: 'papa', name: 'Papa', relation: 'parent', aliases: ['papa', 'dad'] }));
		mockRelay(() =>
			empty({
				people: [{ name: 'Dad', relation: 'parent' }, { name: 'Riya', relation: 'sibling' }],
				events: [{ what: "Papa's 60th birthday", kind: 'birthday', people: ['Dad', 'Riya'], date: '2026-11-04', time: null, date_text: '4 Nov' }],
				gift_hints: [
					{ person: 'Dad', what: 'a brighter reading lamp.' },
					{ person: 'Dad', what: 'a lamp under Rs 2000' },
					{ person: 'Dad', what: 'a new knee brace' }
				]
			})
		);
		await saveFragment("Dad's birthday 4 Nov, he wants a brighter reading lamp", 'typed');
		await idle();
		const gifts = await db.gifts.toArray();
		expect(gifts).toHaveLength(1);
		expect(gifts[0]).toMatchObject({ personId: 'papa', what: 'a brighter reading lamp', status: 'open' });
		expect(await db.occasions.toArray()).toEqual([
			expect.objectContaining({ id: 'birthday:papa', day: '2026-11-04', name: "Papa's birthday", kind: 'birthday', personIds: ['papa'] })
		]);
		// the same hint again is not added twice
		await saveFragment('Dad wants a brighter reading lamp', 'typed');
		await idle();
		expect(await db.gifts.count()).toBe(1);
	});

	it('keeps a plain gift hint the model left out', async () => {
		mockRelay(() => empty({ people: [{ name: 'Mom', relation: 'parent' }, { name: 'Leo', relation: 'sibling' }, { name: 'Dad', relation: 'parent' }] }));
		await saveFragment("Mom's birthday is next Friday, should call Leo before his exams, Dad wants new running shoes", 'typed');
		await idle();
		const dad = (await db.people.toArray()).find((p) => p.name === 'Dad')!;
		expect(await db.gifts.toArray()).toEqual([expect.objectContaining({ personId: dad.id, what: 'new running shoes' })]);
	});

	it('a thought noted on a person stays tagged to them', async () => {
		await db.people.add(mkPerson({ id: 'nani', name: 'Nani', relation: 'family' }));
		mockRelay(() => empty({ people: [{ name: 'Riya', relation: 'sibling' }] }));
		const f = await noteThought('nani', 'ask about the old photos, Riya has some');
		expect(f.personIds).toEqual(['nani']);
		await idle();
		const saved = (await db.fragments.get(f.id))!;
		expect(saved.status).toBe('done');
		expect(saved.personIds![0]).toBe('nani');
		expect(saved.personIds).toHaveLength(2);
	});
});

describe('coming back online', () => {
	it('reads a note typed offline when the online event fires, even if the first fetch still fails', async () => {
		vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
		vi.setSystemTime(NOW);
		const win = new EventTarget();
		vi.stubGlobal('window', win);
		setOffline(true);
		let calls = 0;
		const relay = mockRelay(() => empty());
		const ok = relay.fn.getMockImplementation()!;
		relay.fn.mockImplementation(async (url: string, init?: RequestInit) => {
			calls++;
			if (calls === 1) throw new TypeError('network still waking up');
			return ok(url, init);
		});
		const f = await saveFragment('typed on the train', 'typed');
		await idle();
		expect(relay.fn).not.toHaveBeenCalled();
		setOffline(false);
		win.dispatchEvent(new Event('online'));
		// The first try fails; the second look a few seconds later reads it (not the 2 minute retry).
		for (let i = 0; i < 60 && (await db.fragments.get(f.id))!.status !== 'done'; i++) {
			await vi.advanceTimersByTimeAsync(100);
			await new Promise((r) => (globalThis as unknown as { setImmediate: (f: () => void) => void }).setImmediate(() => r(null)));
		}
		expect((await db.fragments.get(f.id))!.status).toBe('done');
		expect(calls).toBe(2);
		expect(Date.now() - NOW.getTime()).toBeLessThan(ONLINE_SETTLE_MS + 1000);
		expect((await db.fragments.get(f.id))!.tries).toBe(0);
	});
});
