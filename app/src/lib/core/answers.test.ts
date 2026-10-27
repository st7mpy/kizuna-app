import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CircleEntry, Person } from '@kizuna/shared';
import { db, type MemberRow } from '../db.ts';
import {
	answerStamp,
	answerWords,
	answeredLines,
	answeredSince,
	draftNudge,
	followUpTime,
	followUps,
	followUpsDue,
	freshAnswerPeople,
	markInvited,
	markNudged,
	nudgeTemplate,
	windowWords
} from './answers.ts';
import { setHomeZone } from './days.ts';
import { updateSettings } from './settings.ts';
import { lineOk } from './weekend.ts';
import { mkPerson, mkPrompt, mockRelay, resetDb, setOffline } from './testing.ts';

const TZ = 'America/Chicago';
const FRI_NOON = new Date('2026-10-30T12:30:00-05:00'); // Friday 12:30 in Chicago
const TUE = new Date('2026-10-27T12:00:00-05:00');

const entry = (p: Partial<CircleEntry> = {}): CircleEntry => ({
	v: 1, name: 'Mom', tz: TZ, status: null, statusUntil: null, windows: [], via: 'page', updatedAt: '2026-10-30T15:00:00.000Z', ...p
});
const sunday = { start: '2026-11-01T13:00:00-06:00', end: '2026-11-01T17:00:00-06:00' };
const member = (p: Partial<MemberRow> & { memberId: string }): MemberRow => ({ personId: null, entry: entry(), fetchedAt: '2026-10-30T15:00:00.000Z', ...p });
const settings = { quietStart: '21:30', quietEnd: '08:30', weeklyCap: 5 };

beforeEach(() => setHomeZone(TZ));
afterEach(() => {
	setHomeZone(null);
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

describe('answers', () => {
	it('stamps a new or changed family-page answer, never later than now', () => {
		const now = new Date('2026-10-30T16:00:00.000Z');
		expect(answerStamp(undefined, entry(), now)).toEqual({ answeredAt: '2026-10-30T15:00:00.000Z', answerSeen: false });
		expect(answerStamp(undefined, entry({ updatedAt: '2026-11-02T00:00:00.000Z' }), now).answeredAt).toBe(now.toISOString());
		const old = { entry: entry(), answeredAt: '2026-10-30T15:00:00.000Z', answerSeen: true };
		expect(answerStamp(old, entry(), now)).toEqual({ answeredAt: old.answeredAt, answerSeen: true }); // unchanged
		expect(answerStamp(old, entry({ windows: [sunday], updatedAt: '2026-10-30T15:30:00.000Z' }), now)).toEqual({ answeredAt: '2026-10-30T15:30:00.000Z', answerSeen: false });
		// the app shares windows on its own: that is not an answer
		expect(answerStamp(undefined, entry({ via: 'app' }), now)).toEqual({ answeredAt: undefined, answerSeen: undefined });
	});

	it('says what they answered in a few words', () => {
		expect(windowWords(sunday, TZ)).toBe('Sunday afternoon');
		expect(windowWords({ start: '2026-10-31T09:00:00-05:00', end: '2026-10-31T21:00:00-05:00' }, TZ)).toBe('Saturday morning to evening');
		expect(windowWords({ start: '2026-11-01T17:00:00-06:00', end: '2026-11-01T21:00:00-06:00' }, TZ)).toBe('Sunday evening');
		expect(answerWords({ windows: [sunday] }, TZ)).toBe('Sunday afternoon');
		expect(answerWords({ windows: [{ start: '2026-10-31T09:00:00-05:00', end: '2026-10-31T12:00:00-05:00' }, sunday] }, TZ)).toBe('Saturday morning or Sunday afternoon');
		expect(answerWords({ windows: [], notThisWeekend: true }, TZ)).toBe('not this weekend');
	});

	it('one line per answer from the last 48 hours, newest first, until closed', () => {
		const now = new Date('2026-10-30T18:00:00.000Z');
		const people = [{ id: 'mom', name: 'Mom' }, { id: 'gma', name: 'Grandma' }];
		const rows = [
			member({ memberId: 'a', personId: 'mom', entry: entry({ windows: [sunday] }), answeredAt: '2026-10-30T15:00:00.000Z' }),
			member({ memberId: 'b', personId: 'gma', entry: entry({ name: 'Nana', notThisWeekend: true }), answeredAt: '2026-10-30T17:00:00.000Z' }),
			member({ memberId: 'c', personId: null, entry: entry({ name: 'Ravi', windows: [sunday] }), answeredAt: '2026-10-28T17:00:00.000Z' }), // too old
			member({ memberId: 'd', personId: null, entry: entry({ name: 'Zoe', windows: [sunday] }), answeredAt: '2026-10-30T16:00:00.000Z', answerSeen: true }),
			member({ memberId: 'e', personId: null, entry: entry({ name: 'Sam', via: 'app', windows: [sunday] }), answeredAt: '2026-10-30T16:00:00.000Z' })
		];
		expect(answeredLines(rows, people, now, TZ).map((l) => l.text)).toEqual(['Grandma answered: not this weekend', 'Mom answered: Sunday afternoon']);
		expect(freshAnswerPeople(rows, '2026-10-30T16:00:00.000Z')).toEqual(['gma']);
		expect(freshAnswerPeople(rows, null).sort()).toEqual(['gma', 'mom']);
	});
});

describe('follow-ups', () => {
	const invited = '2026-10-28T15:00:00.000Z'; // Wednesday
	const people: Person[] = [
		mkPerson({ id: 'gma', name: 'Grandma', circle: 'in', relation: 'family', invitedAt: invited, phone: '13125550105' }),
		mkPerson({ id: 'mom', name: 'Mom', circle: 'in', relation: 'parent', invitedAt: invited }),
		mkPerson({ id: 'dad', name: 'Dad', circle: 'in', relation: 'parent' }), // never invited
		mkPerson({ id: 'old', name: 'Ravi', circle: 'in', invitedAt: '2026-10-20T15:00:00.000Z' }) // last week
	];
	const members = [member({ memberId: 'm', personId: 'mom', answeredAt: '2026-10-29T15:00:00.000Z' })];

	it('from Friday 12:00 in the home zone', () => {
		expect(followUpTime(new Date('2026-10-30T11:59:00-05:00'))).toBe(false);
		expect(followUpTime(FRI_NOON)).toBe(true);
		expect(followUpTime(new Date('2026-10-31T10:00:00-05:00'))).toBe(true);
		expect(followUpTime(new Date('2026-11-01T20:00:00-06:00'))).toBe(true);
		expect(followUpTime(new Date('2026-11-02T10:00:00-06:00'))).toBe(false);
	});

	it('names who was invited this week and hasn\'t answered', () => {
		expect(answeredSince('mom', members, invited)).toBe(true);
		expect(answeredSince('gma', members, invited)).toBe(false);
		const due = followUpsDue({ now: FRI_NOON, people, members, settings, prompts: [] });
		expect(due).toEqual([{ personId: 'gma', name: 'Grandma', phone: '13125550105', text: "Grandma hasn't answered yet" }]);
		// an answer from before the invite doesn't count
		const before = [member({ memberId: 'g', personId: 'gma', entry: entry({ via: 'app', updatedAt: '2026-10-27T15:00:00.000Z' }) })];
		expect(followUpsDue({ now: FRI_NOON, people, members: before, settings, prompts: [] }).map((f) => f.name)).toContain('Grandma');
	});

	it('stays quiet before Friday noon, in quiet hours, over the weekly cap, and once nudged', () => {
		expect(followUpsDue({ now: TUE, people, members, settings, prompts: [] })).toEqual([]);
		expect(followUpsDue({ now: new Date('2026-10-30T22:00:00-05:00'), people, members, settings, prompts: [] })).toEqual([]);
		const five = Array.from({ length: 5 }, (_, i) => mkPrompt({ personId: `p${i}`, reason: 'gap', shownAt: '2026-10-29T15:00:00.000Z' }));
		expect(followUpsDue({ now: FRI_NOON, people, members, settings, prompts: five })).toEqual([]);
		const nudged = people.map((p) => (p.id === 'gma' ? { ...p, nudgedAt: '2026-10-30T17:00:00.000Z' } : p));
		expect(followUpsDue({ now: FRI_NOON, people: nudged, members, settings, prompts: [] })).toEqual([]);
		// the sample family's demo shows it any day and time (Thursday night here)
		expect(followUpsDue({ now: new Date('2026-10-29T23:00:00-05:00'), people, members, settings, prompts: five, forced: true }).map((f) => f.name)).toEqual(['Grandma']);
	});

	it('the fallback line is gentle and passes the draft checks', () => {
		const a = nudgeTemplate('Grandma', 'https://kizuna.app/c/x#k=y&for=Grandma');
		const b = nudgeTemplate('Grandma');
		expect(a).toBe('Hi Grandma, no rush at all. If you get a minute, tap the times that suit you this weekend: https://kizuna.app/c/x#k=y&for=Grandma');
		expect(lineOk(b)).toBe(true);
		expect(lineOk(a.replace(/https:\S+/, ''))).toBe(true);
		expect(`${a} ${b}`).not.toMatch(/sorry|still|waiting|urgent|asap|haven't|!/i);
	});
});

describe('follow-ups on the phone', () => {
	beforeEach(async () => {
		vi.useFakeTimers({ toFake: ['Date'] });
		vi.setSystemTime(FRI_NOON);
		setOffline(false);
		await resetDb();
		await updateSettings({ myName: 'Alex', homeTz: TZ, relayUrl: 'https://kizuna.test' });
		await db.people.bulkAdd([
			mkPerson({ id: 'gma', name: 'Grandma', circle: 'in', relation: 'family', phone: '13125550105' }),
			mkPerson({ id: 'mom', name: 'Mom', circle: 'in', relation: 'parent' })
		]);
	});

	it('invite, no answer, draft a nudge for the user to send, then quiet', async () => {
		await markInvited(['gma', 'mom'], new Date('2026-10-28T15:00:00.000Z'));
		expect((await followUps()).map((f) => f.text)).toEqual(["Grandma hasn't answered yet", "Mom hasn't answered yet"]);

		setOffline(true);
		const d = await draftNudge('gma');
		expect(d.line).toBe('Hi Grandma, no rush at all. If a call this weekend suits you, just tell me when.');
		expect(d.link).toBe(`https://wa.me/13125550105?text=${encodeURIComponent(d.line)}`);

		await markNudged('gma');
		expect((await followUps()).map((f) => f.name)).toEqual(['Mom']);
		const p = await db.prompts.toArray();
		expect(p).toMatchObject([{ personId: 'gma', reason: 'follow_up', answer: 'poke' }]);
	});

	it('uses a drafted line when it passes the checks, with their own link', async () => {
		await updateSettings({ circle: { id: 'circle0000000001', key: 'k'.repeat(43), memberId: 'me0000000001', share: true, freeToday: false, paused: false } });
		let quickAt = -1;
		const relay = mockRelay(() => {
			quickAt = quick.length; // how many simple lines were already handed over when the model was asked
			return { line: 'Hey Grandma, any time this weekend good for a family call?', language: 'en' };
		});
		const quick: string[] = [];
		const d = await draftNudge('gma', (l) => quick.push(l));
		// a usable line shows before the model is even asked
		expect(quickAt).toBe(1);
		expect(quick[0]).toMatch(/^Hi Grandma, no rush at all\..*\/c\/circle0000000001/);
		expect(relay.tasks()).toEqual(['draft']);
		expect(d.line).toBe(`Hey Grandma, any time this weekend good for a family call? https://kizuna.test/c/circle0000000001#k=${'k'.repeat(43)}&from=Alex&for=Grandma`);
		// a pushy line is replaced by the gentle one
		mockRelay(() => ({ line: 'Grandma, answer ASAP please', language: 'en' }));
		expect((await draftNudge('gma')).line).toMatch(/^Hi Grandma, no rush at all\./);
	});
});
