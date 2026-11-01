import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../db.ts';
import { answerTalk, talkCheck, talkCheckFrom } from './talked.ts';
import { mkPerson, resetDb, setOffline } from './testing.ts';

const NOW = new Date(2026, 10, 1, 10, 0);
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();

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

describe('did you talk?', () => {
	it('asks about a line opened 12 to 48 hours ago, most recent first, once', () => {
		const people = [
			mkPerson({ id: 'a', name: 'Leo', lastReachedAt: hoursAgo(20) }),
			mkPerson({ id: 'b', name: 'Maya', lastReachedAt: hoursAgo(30) }),
			mkPerson({ id: 'c', name: 'Mom', lastReachedAt: hoursAgo(3) }),
			mkPerson({ id: 'd', name: 'Dad', lastReachedAt: hoursAgo(60) })
		];
		expect(talkCheckFrom(people, NOW)).toMatchObject({ personId: 'a', name: 'Leo', when: 'yesterday' });
		people[0].talkAskedFor = people[0].lastReachedAt;
		expect(talkCheckFrom(people, NOW)?.personId).toBe('b');
		expect(talkCheckFrom([mkPerson({ name: 'Ben', circle: 'out', lastReachedAt: hoursAgo(20) })], NOW)).toBeNull();
	});

	it('yes keeps the words as a note about them and stops asking', async () => {
		await db.people.add(mkPerson({ id: 'leo', name: 'Leo', lastReachedAt: hoursAgo(20) }));
		expect((await talkCheck())?.personId).toBe('leo');
		await answerTalk('leo', 'yes', 'First exam went well, nervous about maths');
		expect(await talkCheck()).toBeNull();
		const notes = await db.fragments.where('personIds').equals('leo').toArray();
		expect(notes.map((n) => n.text)).toEqual(['First exam went well, nervous about maths']);
		expect((await db.people.get('leo'))!.lastReachedAt).toBe(hoursAgo(20));
	});

	it('not yet lets the usual nudges bring them back; skip only stops asking', async () => {
		await db.people.bulkAdd([mkPerson({ id: 'leo', name: 'Leo', lastReachedAt: hoursAgo(20) }), mkPerson({ id: 'maya', name: 'Maya', lastReachedAt: hoursAgo(25) })]);
		await answerTalk('leo', 'not_yet');
		expect((await db.people.get('leo'))!.lastReachedAt).toBeUndefined();
		await answerTalk('maya', 'skip');
		expect((await db.people.get('maya'))!.lastReachedAt).toBe(hoursAgo(25));
		expect(await talkCheck()).toBeNull();
		expect(await db.fragments.count()).toBe(0);
	});
});
