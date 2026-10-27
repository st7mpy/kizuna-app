import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CircleEntry, WeekendInput, WeekendPerson } from '@kizuna/shared';
import { db, defaultSettings } from '../db.ts';
import { deviceTimeZone } from './days.ts';
import { updateSettings } from './settings.ts';
import { mkPerson, mkPrompt, mkThread, mockRelay, resetDb, setOffline } from './testing.ts';
import {
	WHATSAPP_SCHEDULE_TIP,
	answerWeekend,
	checkPlan,
	draftForGroup,
	draftForPerson,
	groupTemplate,
	hasReason,
	lineOk,
	localWeekendPlan,
	planWeekend,
	specificWhy,
	weekendCard,
	weekendRange
} from './weekend.ts';

// ---------- pure ----------

describe('the Friday rule', () => {
	it('opens Friday 18:00 and closes at the end of Sunday', () => {
		expect(weekendRange(new Date(2026, 9, 29, 20, 0))).toBeNull(); // Thursday
		expect(weekendRange(new Date(2026, 9, 30, 17, 59))).toBeNull();
		const fri = weekendRange(new Date(2026, 9, 30, 18, 0))!;
		expect(fri.saturday).toBe('2026-10-31');
		expect(fri.to).toBe(new Date(2026, 10, 2, 0, 0).getTime());
		expect(weekendRange(new Date(2026, 9, 31, 9, 0))!.saturday).toBe('2026-10-31');
		expect(weekendRange(new Date(2026, 10, 1, 21, 0))!.saturday).toBe('2026-10-31');
		expect(weekendRange(new Date(2026, 10, 2, 9, 0))).toBeNull(); // Monday
	});
	it('can be forced for a demo: the coming weekend', () => {
		const r = weekendRange(new Date(2026, 9, 27, 9, 0), true)!; // Tuesday
		expect(r.saturday).toBe('2026-10-31');
		expect(r.from).toBe(new Date(2026, 9, 30, 18, 0).getTime());
		// late on Sunday, the next one
		expect(weekendRange(new Date(2026, 10, 1, 15, 0), true)!.saturday).toBe('2026-11-07');
	});
});

const IST = 'Asia/Kolkata';
const person = (id: string, tz: string, windows: [string, string][], p: Partial<WeekendPerson> = {}): WeekendPerson => ({
	id, name: id, relation: 'family', timeZone: tz, language: 'mixed', windows: windows.map(([start, end]) => ({ start, end })), quietStart: '22:00', quietEnd: '08:00', ...p
});
function input(p: Partial<WeekendInput> = {}): WeekendInput {
	return {
		request: '',
		now: '2026-11-06T18:30:00+05:30', // Friday evening in Delhi
		timeZone: IST,
		me: { name: 'Alex', windows: [{ start: '2026-11-08T10:00:00+05:30', end: '2026-11-08T13:00:00+05:30' }, { start: '2026-11-07T18:00:00+05:30', end: '2026-11-07T21:00:00+05:30' }], quietStart: '21:30', quietEnd: '08:30' },
		people: [
			person('mom', IST, [['2026-11-08T10:00:00+05:30', '2026-11-08T13:00:00+05:30']]),
			person('dad', IST, [['2026-11-08T10:30:00+05:30', '2026-11-08T12:00:00+05:30']]),
			// Toronto: Sun 10:30 Delhi is 00:00 there; Sat 08:30 Toronto is 19:00 Delhi
			person('jordan', 'America/Toronto', [['2026-11-07T08:30:00-05:00', '2026-11-07T11:00:00-05:00'], ['2026-11-07T23:00:00-05:00', '2026-11-08T02:00:00-05:00']], { relation: 'friend', language: 'en' })
		],
		occasions: [{ day: '2026-11-08', name: 'Thanksgiving', kind: 'festival', personIds: [], region: 'US' }],
		reasons: [],
		minMinutes: 45,
		...p
	};
}

describe('the plan', () => {
	it('finds the slot with the most people, on the occasion, outside quiet hours everywhere', () => {
		const out = localWeekendPlan(input());
		expect(out.slot!.start).toBe('2026-11-08T10:30:00+05:30'); // Sun 10:30 Delhi
		expect(out.slot!.label).toBe('Sun 8 Nov, 10:30 to 11:30');
		expect(out.personIds.sort()).toEqual(['dad', 'mom']);
		expect(out.reason).toBe("It's Thanksgiving morning.");
		expect(out.occasion).toBe('Thanksgiving');
		// Jordan has a window then, but it's the middle of his night
		const jordan = out.skipped.find((s) => s.personId === 'jordan')!;
		expect(jordan.why).toMatch(/asleep then \(00:00 Toronto\)/);
		expect(jordan.alt!.label).toBe('Sat 7 Nov, 19:00 to 20:00');
	});

	it('needs at least 45 minutes together', () => {
		const short = input({ people: [person('mom', IST, [['2026-11-08T12:30:00+05:30', '2026-11-08T14:00:00+05:30']])] });
		expect(localWeekendPlan(short).slot).toBeNull();
		const enough = input({ people: [person('mom', IST, [['2026-11-08T12:15:00+05:30', '2026-11-08T14:00:00+05:30']])] });
		expect(localWeekendPlan(enough).slot?.label).toBe('Sun 8 Nov, 12:15 to 13:00');
	});

	it('respects their quiet hours in their own zone', () => {
		const late = input({ people: [person('sofia', 'Europe/London', [['2026-11-07T00:00:00+00:00', '2026-11-08T23:00:00+00:00']], { quietStart: '21:00', quietEnd: '09:00' })] });
		const out = localWeekendPlan(late);
		// Sun 10:00 Delhi = 04:30 London (quiet); Sat 18:00 Delhi = 12:30 London (fine)
		expect(out.slot!.label).toBe('Sat 7 Nov, 18:00 to 19:00');
	});

	it('needs a reason: an occasion within 10 days or a thread', () => {
		expect(hasReason(input())).toBe(true);
		expect(hasReason(input({ occasions: [] }))).toBe(false);
		expect(hasReason(input({ occasions: [{ day: '2026-11-20', name: 'X', kind: 'festival', personIds: [] }] }))).toBe(false);
		expect(hasReason(input({ occasions: [], reasons: [{ personId: 'mom', text: 'Lake trip plan' }] }))).toBe(true);
	});

	it('checks the planner: keeps a good answer, drops one outside the windows', () => {
		const i = input();
		const range = { from: Date.parse(i.now), to: Date.parse('2026-11-09T00:00:00+05:30') };
		const good = checkPlan(
			{ slot: { start: '2026-11-08T10:30:00+05:30', end: '2026-11-08T11:30:00+05:30', label: 'x' }, personIds: ['mom', 'dad', 'ghost'], skipped: [], reason: 'Thanksgiving morning together.', occasion: 'Thanksgiving', tools_used: ['get_windows', 'finish'] },
			i,
			range
		)!;
		expect(good.personIds).toEqual(['mom', 'dad']);
		expect(good.slot!.label).toBe('Sun 8 Nov, 10:30 to 11:30');
		expect(good.tools_used).toEqual(['get_windows', 'finish']);
		const bad = { slot: { start: '2026-11-08T15:00:00+05:30', end: '2026-11-08T16:00:00+05:30', label: '' }, personIds: ['mom'], skipped: [], reason: '', occasion: null, tools_used: [] };
		expect(checkPlan(bad, i, range)).toBeNull();
		const health = checkPlan({ ...good, reason: "Mom's knee surgery is done." }, i, range)!;
		expect(health.reason).toBe("It's Thanksgiving morning.");
	});
});

describe('why someone is skipped', () => {
	it('names their local time when they live elsewhere', () => {
		const i = input();
		const at = Date.parse('2026-11-08T10:30:00+05:30');
		const out = specificWhy([{ personId: 'jordan', why: 'Not free then.', alt: null }, { personId: 'mom', why: 'not free then', alt: null }, { personId: 'dad', why: 'At the game', alt: null }], i, at);
		expect(out.map((x) => x.why)).toEqual(["It's 00:00 in Toronto then.", 'Not free then.', 'At the game']);
		// Their zone rides along, so the card's "instead?" line can name their time too.
		expect(out.map((x) => x.tz)).toEqual(['America/Toronto', undefined, undefined]);
	});
});

describe('drafts (pure)', () => {
	const card = { kind: 'weekend' as const, slot: { start: '2026-11-08T05:00:00.000Z', end: '2026-11-08T06:00:00.000Z', label: '' }, personIds: [], skipped: [], reason: '', occasion: 'Thanksgiving', trace: [] };
	it('family group line in plain English, whatever the notes were in', () => {
		expect(groupTemplate(card, 'mixed', IST)).toBe("Thanksgiving video call? Sunday at 10:30, everyone's free then.");
		expect(groupTemplate({ ...card, occasion: null }, 'en', IST)).toBe("Family video call? Sunday at 10:30, everyone's free then.");
		expect(lineOk(groupTemplate(card, 'mixed', IST))).toBe(true);
	});
	it('screens drafts for money, health, guilt', () => {
		expect(lineOk('The lamp costs Rs 2000, split it?')).toBe(false);
		expect(lineOk('How was the surgery?')).toBe(false);
		expect(lineOk("It's been ages! Call?")).toBe(false);
		expect(lineOk('Sunday call?')).toBe(true);
		expect(WHATSAPP_SCHEDULE_TIP).toBe('In WhatsApp: Calls, then +, then Schedule call');
	});
});

// ---------- with the db ----------

// Friday 19 Feb 2027: no festival within 10 days, so a reason must come from a thread.
const FRI = new Date(2027, 1, 19, 19, 0);
const local = (d: number, h: number, m = 0) => new Date(2027, 1, 19 + d, h, m).toISOString();
const ms = (iso: string | undefined) => (iso ? Date.parse(iso) : NaN);
const entry = (name: string, windows: [string, string][]): CircleEntry => ({
	v: 1, name, tz: deviceTimeZone(), status: null, statusUntil: null, windows: windows.map(([start, end]) => ({ start, end })), via: 'app', updatedAt: FRI.toISOString()
});

async function seed(withThread = true) {
	await db.settings.put({ ...defaultSettings(), myName: 'Alex', circle: { id: 'circle0000000001', key: 'k', memberId: 'me0000000001', share: true, freeToday: false, paused: false } });
	await db.people.bulkAdd([
		mkPerson({ id: 'mom', name: 'Mom', relation: 'parent', circle: 'in' }),
		mkPerson({ id: 'dad', name: 'Dad', relation: 'parent', circle: 'in', phone: '131255501003' }),
		mkPerson({ id: 'jordan', name: 'Jordan', circle: 'in', phone: '131255501001' })
	]);
	// default free hours: Sat/Sun 10:00-13:00 and 16:00-20:00
	await db.members.bulkPut([
		{ memberId: 'm1', personId: 'mom', entry: entry('Mom', [[local(1, 10), local(1, 12)]]), fetchedAt: '' },
		{ memberId: 'm2', personId: 'dad', entry: entry('Dad', [[local(1, 10, 30), local(1, 12)]]), fetchedAt: '' },
		{ memberId: 'm3', personId: 'jordan', entry: entry('Jordan', [[local(2, 17), local(2, 19)]]), fetchedAt: '' }
	]);
	if (withThread) await db.threads.add(mkThread({ title: "Dad's 60th", kind: 'plan', personIds: ['dad', 'mom'] }));
}

beforeEach(async () => {
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(FRI);
	setOffline(true);
	await resetDb();
});
afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

describe('weekendCard', () => {
	it('plans on the phone when offline', async () => {
		await seed();
		const card = (await weekendCard())!;
		expect(card.kind).toBe('weekend');
		expect(ms(card.slot.start)).toBe(Date.parse(local(1, 10, 30)));
		expect(card.personIds.sort()).toEqual(['dad', 'mom']);
		expect(card.reason).toBe("On your mind: Dad's 60th.");
		expect(card.skipped.map((s) => s.personId)).toEqual(['jordan']);
		expect(card.skipped[0].why).toBe('Not free then.'); // same zone as me
		expect(ms(card.skipped[0].alt?.start)).toBe(Date.parse(local(2, 17)));
	});

	it('says nothing without a reason, before Friday 18:00, or over the cap', async () => {
		await seed(false);
		expect(await weekendCard()).toBeNull();
		await db.threads.add(mkThread({ title: 'Call Jordan', kind: 'promise', personIds: ['jordan'] }));
		vi.setSystemTime(new Date(2027, 1, 19, 17, 0));
		expect(await weekendCard()).toBeNull();
		vi.setSystemTime(FRI);
		expect(await weekendCard()).not.toBeNull();
		await db.prompts.bulkAdd([1, 2, 3, 4, 5].map((d) => mkPrompt({ personId: 'x', reason: 'gap', shownAt: new Date(2027, 1, 19 - d, 12).toISOString() })));
		expect(await weekendCard()).toBeNull();
	});

	it('says nothing when nobody shares a long enough window', async () => {
		await seed();
		await db.members.clear();
		await db.members.put({ memberId: 'm1', personId: 'mom', entry: entry('Mom', [[local(1, 12, 30), local(1, 14)]]), fetchedAt: '' });
		expect(await weekendCard()).toBeNull();
	});

	it('the demo setting shows it on a weekday', async () => {
		await seed();
		vi.setSystemTime(new Date(2027, 1, 16, 9, 0)); // Tuesday
		expect(await weekendCard()).toBeNull();
		await updateSettings({ forceWeekend: true });
		expect(ms((await weekendCard())?.slot.start)).toBe(Date.parse(local(1, 10, 30)));
	});

	it('not now hides it until next weekend', async () => {
		await seed();
		await answerWeekend('not_now');
		expect(await weekendCard()).toBeNull();
		vi.setSystemTime(new Date(2027, 1, 21, 9, 0)); // Sunday, same weekend
		expect(await weekendCard()).toBeNull();
	});

	it('uses the Spark planner when online, checked, and plans once a day', async () => {
		await seed();
		setOffline(false);
		const relay = mockRelay((task, i) => {
			expect(task).toBe('weekend');
			expect(i.people.map((p: WeekendPerson) => p.id).sort()).toEqual(['dad', 'jordan', 'mom']);
			expect(JSON.stringify(i)).not.toMatch(/knee/);
			return { slot: { start: local(1, 11), end: local(1, 12), label: '' }, personIds: ['mom', 'dad'], skipped: [], reason: 'A calm Saturday morning.', occasion: null, tools_used: ['get_windows', 'get_local_time', 'finish'] };
		});
		const card = (await weekendCard())!;
		expect(ms(card.slot.start)).toBe(Date.parse(local(1, 11)));
		expect(card.reason).toBe('A calm Saturday morning.');
		expect(card.trace).toEqual(['get_windows', 'get_local_time', 'finish']);
		await weekendCard();
		expect(relay.tasks()).toEqual(['weekend']);
	});

	it('falls back when the planner answers badly', async () => {
		await seed();
		setOffline(false);
		mockRelay(() => ({ slot: { start: local(1, 22), end: local(1, 23), label: '' }, personIds: ['mom'], skipped: [], reason: 'x', occasion: null, tools_used: [] }));
		expect(ms((await weekendCard())!.slot.start)).toBe(Date.parse(local(1, 10, 30)));
	});

	it('takes a plain-language change', async () => {
		await seed();
		setOffline(false);
		const relay = mockRelay((_t, i) => {
			expect(i.request).toBe('not Saturday');
			return { slot: { start: local(2, 17), end: local(2, 18), label: '' }, personIds: ['jordan'], skipped: [], reason: 'Sunday evening works.', occasion: null, tools_used: ['finish'] };
		});
		const card = (await planWeekend('not Saturday'))!;
		expect(card.personIds).toEqual(['jordan']);
		expect(relay.tasks()).toEqual(['weekend']);
		// the change sticks for the day
		expect((await weekendCard())!.personIds).toEqual(['jordan']);
	});
});

describe('weekend drafts', () => {
	it('a group line with no number, and a line for someone skipped with their other time', async () => {
		await seed();
		const card = (await weekendCard())!;
		const group = await draftForGroup(card);
		expect(group.line).toMatch(/everyone's free then\.$/);
		expect(group.link.startsWith('https://wa.me/?text=')).toBe(true);
		const jordan = await draftForPerson(card, 'jordan');
		expect(jordan.line).toMatch(/^Hi Jordan, we're doing a family call this weekend\. Would Sun \d+ Feb, 17:00 work for you\?$/);
		expect(jordan.link.startsWith('https://wa.me/131255501001?text=')).toBe(true);
	});

	it('the draft for a skipped person names their other time, in their zone, never the group time', async () => {
		await seed();
		const card = (await weekendCard())!;
		const alt = { start: '2026-10-31T23:00:00Z', end: '2026-11-01T00:00:00Z', label: '' }; // Sat 18:00 Chicago = Sun 10:00 Melbourne
		await db.members.where('personId').equals('jordan').delete();
		const c = { ...card, personIds: card.personIds.filter((id) => id !== 'jordan'), skipped: [{ personId: 'jordan', why: 'x', alt, tz: 'Australia/Melbourne' }] };
		const d = await draftForPerson(c, 'jordan');
		expect(d.line).toContain('Would Sun 1 Nov, 10:00 work for you?');
		expect(d.line).not.toContain(card.slot.label.replace(/ to .*/, ''));
	});

	it('uses the drafted line when it passes the checks', async () => {
		await seed();
		const card = (await weekendCard())!;
		setOffline(false);
		mockRelay(() => ({ line: 'Family call on Sunday? 10:30 works for everyone', language: 'en' }));
		expect((await draftForGroup(card)).line).toBe('Family call on Sunday? 10:30 works for everyone');
		mockRelay(() => ({ line: 'Hi the family group, how are you? Call on Sun 8 Nov?', language: 'en' }));
		expect((await draftForGroup(card)).line).toMatch(/everyone's free then/);
		mockRelay(() => ({ line: "It's been ages, call urgently", language: 'en' }));
		expect((await draftForGroup(card)).line).toMatch(/everyone's free then/);
	});
});
