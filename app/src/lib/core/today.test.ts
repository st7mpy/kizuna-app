import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db, defaultSettings } from '../db.ts';
import { localDay } from './days.ts';
import { getSettings, setRoom, updateSettings } from './settings.ts';
import { answerCard, todayCards } from './today.ts';
import { mkEvent, mkPerson, mkThread, mockRelay, resetDb, setOffline } from './testing.ts';

const at = (d: number, h = 10, m = 0) => new Date(2026, 9, 26 + d, h, m); // Mon 26 Oct 2026

async function seed() {
	await db.people.bulkAdd([
		mkPerson({ id: 'kabir', name: 'Kabir', circle: 'in', lastMentionedAt: at(-1).toISOString() }),
		mkPerson({ id: 'mum', name: 'Mum', relation: 'parent', circle: 'in', lastMentionedAt: at(-1).toISOString() }),
		mkPerson({ id: 'nani', name: 'Nani', circle: 'in', lastMentionedAt: at(-30).toISOString() }),
		mkPerson({ id: 'meera', name: 'Meera', circle: 'suggested', why: 'New baby, you mention her often' })
	]);
	await db.events.bulkAdd([
		mkEvent({ what: 'started new job', personIds: ['kabir'], day: localDay(at(-1)) }),
		mkEvent({ what: 'knee appointment', personIds: ['mum'], day: localDay(at(3)) })
	]);
	await db.threads.add(mkThread({ id: 'trip', title: 'Goa trip plan', kind: 'plan' }));
}

beforeEach(async () => {
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(at(0));
	setOffline(true); // deterministic order unless a test turns it on
	await resetDb();
});
afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

describe('settings', () => {
	it('has the defaults', async () => {
		const s = await getSettings();
		expect(s).toMatchObject({ quietStart: '21:30', quietEnd: '08:30', weeklyCap: 5, languageBias: ['en', 'hi'], notesSinceWeave: 0 });
		expect(s.freeHours.filter((w) => w.day === 3)).toEqual([{ day: 3, start: '18:30', end: '21:30' }]);
		expect(s.freeHours.filter((w) => w.day === 6)).toHaveLength(2);
		expect(s.timeZone).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
	});
	it('updates and stores the room for today', async () => {
		await updateSettings({ myName: 'Aarav' });
		await setRoom('low');
		expect(await getSettings()).toMatchObject({ myName: 'Aarav', room: { day: '2026-10-26', level: 'low' } });
	});
});

describe('todayCards', () => {
	it('is happily empty with no data', async () => {
		expect(await todayCards()).toEqual([]);
	});

	it('shows people with a reason and a free window, then threads', async () => {
		await seed();
		await setRoom('lots');
		const cards = await todayCards();
		expect(cards.map((c) => `${c.kind}:${c.title}`)).toEqual([
			'person:Kabir', 'person:Mum', 'person:Nani', 'suggest_circle:Meera', 'thread:Goa trip plan'
		]);
		expect(cards[0].reason).toBe("Started new job yesterday. You're free this evening.");
		expect(cards[0].slot).toBeTruthy();
		expect(cards[0].actions).toEqual(['poke', 'time', 'not_now']);
		expect(cards[3].actions).toEqual(['keep', 'not_now']);
		expect(cards[4].actions).toEqual(['done', 'not_now']);
		expect(await db.prompts.count()).toBe(5);
	});

	it('defaults to some room (3 cards) and returns the same prompts on reload', async () => {
		await seed();
		const a = await todayCards();
		const b = await todayCards();
		expect(a).toHaveLength(3);
		expect(b.map((c) => c.promptId)).toEqual(a.map((c) => c.promptId));
		expect(await db.prompts.count()).toBe(3);
	});

	it('stays quiet about people during quiet hours', async () => {
		await seed();
		vi.setSystemTime(at(0, 23));
		const cards = await todayCards();
		expect(cards.map((c) => c.kind)).toEqual(['thread']);
	});

	it('handles answers: not now hides, keep adds to circle, done closes a thread', async () => {
		await seed();
		await setRoom('lots');
		const cards = await todayCards();
		const byTitle = (t: string) => cards.find((c) => c.title === t)!;
		await answerCard(byTitle('Kabir').promptId, 'not_now');
		await answerCard(byTitle('Meera').promptId, 'keep');
		await answerCard(byTitle('Goa trip plan').promptId, 'done');
		expect((await db.people.get('meera'))!.circle).toBe('in');
		expect((await db.threads.get('trip'))!.status).toBe('done');
		const again = await todayCards();
		expect(again.map((c) => c.title)).toEqual(['Mum', 'Nani']);
		// three days later Kabir may come back (with a new reason)
		vi.setSystemTime(at(3, 10));
		await db.events.add(mkEvent({ what: 'farewell drinks', personIds: ['kabir'], day: localDay(at(4)) }));
		expect((await todayCards()).map((c) => c.title)).toContain('Kabir');
	});

	it('suggest not now moves the person out of the circle', async () => {
		await db.people.add(mkPerson({ id: 'riya', name: 'Riya', circle: 'suggested' }));
		const [card] = await todayCards();
		await answerCard(card.promptId, 'not_now');
		expect((await db.people.get('riya'))!.circle).toBe('out');
	});

	it('uses the rank task only when online and over the room', async () => {
		await seed();
		await setRoom('low');
		setOffline(false);
		const relay = mockRelay((task, input) => {
			expect(task).toBe('rank');
			expect(input.room).toBe('low');
			return { order: ['p:nani', 'p:kabir'] };
		});
		const cards = await todayCards();
		expect(cards.map((c) => c.title)).toEqual(['Nani']);
		expect(relay.tasks()).toEqual(['rank']);
	});

	it('falls back to its own order when ranking fails', async () => {
		await seed();
		await setRoom('low');
		setOffline(false);
		mockRelay(() => {
			throw new Error('down');
		});
		expect((await todayCards()).map((c) => c.title)).toEqual(['Kabir']);
	});

	it('does not call rank when everything fits', async () => {
		await db.people.add(mkPerson({ id: 'kabir', name: 'Kabir', circle: 'in' }));
		await db.events.add(mkEvent({ what: 'new job', personIds: ['kabir'], day: localDay(at(0)) }));
		setOffline(false);
		const relay = mockRelay(() => ({ order: [] }));
		expect(await todayCards()).toHaveLength(1);
		expect(relay.fn).not.toHaveBeenCalled();
	});

	it('weekly cap holds across days', async () => {
		await db.settings.put({ ...defaultSettings(), weeklyCap: 2 });
		await seed();
		await setRoom('lots');
		const first = await todayCards();
		expect(first.filter((c) => c.kind === 'person')).toHaveLength(2);
		vi.setSystemTime(at(1, 10));
		await setRoom('lots');
		expect((await todayCards()).filter((c) => c.kind === 'person')).toHaveLength(0);
	});
});
