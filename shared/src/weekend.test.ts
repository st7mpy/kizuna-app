import { describe, expect, it } from 'vitest';
import type { WeekendInput } from './circle.ts';
import {
	bestWeekendSlot,
	checkWeekendSlot,
	comingWeekend,
	excludedWeekdays,
	isQuietAt,
	localTimeFor,
	weekendCandidates,
	weekendRange
} from './weekend.ts';

const IST = 'Asia/Kolkata';
const w = (start: string, end: string) => ({ start, end });

// Friday 30 Oct 2026, 18:10 in Delhi. The weekend is Sat 31 Oct and Sun 1 Nov.
export const sampleWeekend: WeekendInput = {
	request: '',
	now: '2026-10-30T18:10:00+05:30',
	timeZone: IST,
	me: {
		name: 'Aarav',
		windows: [w('2026-10-31T17:00:00+05:30', '2026-10-31T23:00:00+05:30'), w('2026-11-01T09:00:00+05:30', '2026-11-01T13:00:00+05:30')],
		quietStart: '22:00',
		quietEnd: '08:00'
	},
	people: [
		{ id: 'mum', name: 'Mum', relation: 'parent', timeZone: IST, language: 'mixed', quietStart: '22:00', quietEnd: '07:00', windows: [w('2026-10-31T17:00:00+05:30', '2026-10-31T21:00:00+05:30'), w('2026-11-01T09:00:00+05:30', '2026-11-01T12:00:00+05:30')] },
		{ id: 'papa', name: 'Papa', relation: 'parent', timeZone: IST, language: 'hi', quietStart: '22:00', quietEnd: '07:00', windows: [w('2026-11-01T09:00:00+05:30', '2026-11-01T12:00:00+05:30')] },
		{ id: 'riya', name: 'Riya', relation: 'sibling', timeZone: IST, language: 'mixed', quietStart: '23:00', quietEnd: '08:00', windows: [w('2026-11-01T10:00:00+05:30', '2026-11-01T13:00:00+05:30')] },
		// Toronto: Sat 10:00 to 13:00 there is Sat 19:30 to 22:30 in Delhi. Also free late Saturday night there.
		{ id: 'kabir', name: 'Kabir', relation: 'friend', timeZone: 'America/Toronto', language: 'en', quietStart: '23:00', quietEnd: '08:00', windows: [w('2026-10-31T10:00:00-04:00', '2026-10-31T13:00:00-04:00'), w('2026-10-31T22:00:00-04:00', '2026-11-01T01:30:00-04:00')] },
		{ id: 'meera', name: 'Meera', relation: 'friend', timeZone: 'Europe/London', language: 'en', quietStart: '22:00', quietEnd: '08:00', windows: [] }
	],
	occasions: [{ day: '2026-11-01', name: 'Diwali', kind: 'festival', personIds: [], region: 'IN' }],
	reasons: [{ personId: 'kabir', text: 'Kabir started a new job.' }],
	minMinutes: 45
};

describe('comingWeekend and weekendRange', () => {
	it('finds the coming Saturday and Sunday', () => {
		expect(comingWeekend('2026-10-30')).toEqual({ sat: '2026-10-31', sun: '2026-11-01' });
		expect(comingWeekend('2026-10-26')).toEqual({ sat: '2026-10-31', sun: '2026-11-01' });
		expect(comingWeekend('2026-10-31')).toEqual({ sat: '2026-10-31', sun: '2026-11-01' });
		expect(comingWeekend('2026-11-01')).toEqual({ sat: '2026-10-31', sun: '2026-11-01' });
	});
	it('starts at Saturday midnight, or now during the weekend', () => {
		const r = weekendRange(sampleWeekend);
		expect(new Date(r.from).toISOString()).toBe('2026-10-30T18:30:00.000Z');
		expect(new Date(r.to).toISOString()).toBe('2026-11-01T18:30:00.000Z');
		const sun = weekendRange({ ...sampleWeekend, now: '2026-11-01T11:00:00+05:30' });
		expect(sun.from).toBe(Date.parse('2026-11-01T11:00:00+05:30'));
	});
});

describe('quiet hours', () => {
	it('spans midnight', () => {
		expect(isQuietAt(Date.parse('2026-10-31T23:30:00+05:30'), IST, '22:00', '08:00')).toBe(true);
		expect(isQuietAt(Date.parse('2026-10-31T07:59:00+05:30'), IST, '22:00', '08:00')).toBe(true);
		expect(isQuietAt(Date.parse('2026-10-31T08:00:00+05:30'), IST, '22:00', '08:00')).toBe(false);
	});
	it('is read in the person’s own zone', () => {
		const t = localTimeFor(sampleWeekend, 'kabir', Date.parse('2026-11-01T10:00:00+05:30'));
		expect(t).toMatchObject({ local: '00:30', weekday: 'Sunday', timeZone: 'America/Toronto', quiet: true });
		expect(localTimeFor(sampleWeekend, 'nobody', Date.now())).toBeNull();
	});
});

describe('weekendCandidates', () => {
	it('puts the biggest group first and never includes quiet hours', () => {
		const c = weekendCandidates(sampleWeekend, weekendRange(sampleWeekend));
		expect(c[0]).toMatchObject({ start: Date.parse('2026-11-01T10:00:00+05:30'), end: Date.parse('2026-11-01T11:00:00+05:30') });
		expect(c[0].personIds).toEqual(['mum', 'papa', 'riya']);
		// Kabir's late Saturday window (his 22:00 to 01:30) is cut at his 23:00 and at the user's 22:00.
		for (const x of c) {
			if (!x.personIds.includes('kabir')) continue;
			expect(isQuietAt(x.start, 'America/Toronto', '23:00', '08:00')).toBe(false);
			expect(isQuietAt(x.end - 1, IST, '22:00', '08:00')).toBe(false);
		}
	});
	it('needs at least minMinutes together', () => {
		const tight: WeekendInput = {
			...sampleWeekend,
			me: { ...sampleWeekend.me, windows: [w('2026-11-01T09:00:00+05:30', '2026-11-01T09:30:00+05:30')] }
		};
		expect(weekendCandidates(tight, weekendRange(tight))).toEqual([]);
		expect(weekendCandidates(tight, { ...weekendRange(tight), minMinutes: 30 })).toHaveLength(1);
	});
});

describe('bestWeekendSlot', () => {
	it('picks the most people, on the occasion day, and says who is left out', () => {
		const out = bestWeekendSlot(sampleWeekend);
		expect(out.slot).toEqual({ start: '2026-11-01T10:00:00+05:30', end: '2026-11-01T11:00:00+05:30', label: 'Sun 1 Nov, 10:00 to 11:00' });
		expect(out.personIds).toEqual(['mum', 'papa', 'riya']);
		expect(out.reason).toBe("It's Diwali morning.");
		expect(out.occasion).toBe('Diwali');
		expect(out.tools_used).toEqual([]);
		// Meera shared nothing, so she is not listed. Kabir is asleep then; his alt is Saturday evening in Delhi.
		expect(out.skipped).toEqual([
			{ personId: 'kabir', why: "It's 00:30 in Toronto then.", alt: { start: '2026-10-31T19:30:00+05:30', end: '2026-10-31T20:30:00+05:30', label: 'Sat 31 Oct, 19:30 to 20:30' } }
		]);
	});

	it('honours "not Sunday"', () => {
		const out = bestWeekendSlot({ ...sampleWeekend, request: 'not Sunday, Papa has puja' });
		expect(out.slot?.start).toBe('2026-10-31T19:30:00+05:30');
		expect(out.personIds).toEqual(['mum', 'kabir']);
		expect(out.occasion).toBe('Diwali');
		expect(out.reason).toBe('Diwali is on Sunday.');
	});

	it('uses a note reason when there is no occasion', () => {
		const out = bestWeekendSlot({ ...sampleWeekend, request: 'not Sunday', occasions: [] });
		expect(out.reason).toBe('Kabir started a new job.');
		expect(out.occasion).toBeNull();
	});

	it('returns slot null when nobody overlaps', () => {
		const lonely: WeekendInput = { ...sampleWeekend, people: sampleWeekend.people.map((p) => ({ ...p, windows: [] })) };
		const out = bestWeekendSlot(lonely);
		expect(out.slot).toBeNull();
		expect(out.personIds).toEqual([]);
		expect(bestWeekendSlot({ ...sampleWeekend, me: { ...sampleWeekend.me, windows: [] } }).slot).toBeNull();
	});

	it('is deterministic', () => {
		expect(bestWeekendSlot(sampleWeekend)).toEqual(bestWeekendSlot(structuredClone(sampleWeekend)));
	});

	it('survives a bad time zone or time', () => {
		expect(bestWeekendSlot({ ...sampleWeekend, timeZone: 'Moon/Base' }).slot).toBeNull();
		expect(bestWeekendSlot({ ...sampleWeekend, now: 'soon' }).slot).toBeNull();
	});
});

describe('checkWeekendSlot', () => {
	const slot = { start: '2026-11-01T10:00:00+05:30', end: '2026-11-01T11:00:00+05:30' };
	it('keeps people who are free for the whole slot', () => {
		expect(checkWeekendSlot(sampleWeekend, slot, ['mum', 'papa', 'riya', 'kabir', 'ghost'])).toEqual({ meFree: true, personIds: ['mum', 'papa', 'riya'] });
	});
	it('drops people when the slot runs past their window', () => {
		expect(checkWeekendSlot(sampleWeekend, { start: '2026-11-01T11:30:00+05:30', end: '2026-11-01T12:30:00+05:30' }, ['mum', 'riya']).personIds).toEqual(['riya']);
	});
	it('catches quiet hours and the user being busy', () => {
		const late = { start: '2026-10-31T22:30:00+05:30', end: '2026-10-31T23:00:00+05:30' };
		expect(checkWeekendSlot(sampleWeekend, late, ['kabir']).meFree).toBe(false);
		const r = checkWeekendSlot(sampleWeekend, { start: '2026-11-01T08:00:00+05:30', end: '2026-11-01T09:00:00+05:30' }, ['mum']);
		expect(r.meFree).toBe(false);
	});
	it('rejects slots in the past or far ahead', () => {
		expect(checkWeekendSlot(sampleWeekend, { start: '2026-10-29T10:00:00+05:30', end: '2026-10-29T11:00:00+05:30' }, ['mum']).meFree).toBe(false);
		expect(checkWeekendSlot(sampleWeekend, { start: '2026-11-20T10:00:00+05:30', end: '2026-11-20T11:00:00+05:30' }, ['mum']).meFree).toBe(false);
	});
});

describe('excludedWeekdays', () => {
	it('reads English and Hinglish', () => {
		expect(excludedWeekdays('not Sunday, Papa has puja')).toEqual([0]);
		expect(excludedWeekdays('Sunday nahi')).toEqual([0]);
		expect(excludedWeekdays('except saturday')).toEqual([6]);
		expect(excludedWeekdays('Sunday works')).toEqual([]);
		expect(excludedWeekdays('')).toEqual([]);
	});
});
