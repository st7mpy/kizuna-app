import { describe, expect, it } from 'vitest';
import {
	freeSlots,
	pickSpread,
	sampleSlots,
	slotAddDays,
	slotLabel,
	slotWeekday,
	zonedDay,
	zonedIso,
	zonedOffsetMinutes,
	zonedToUtc,
	isValidTimeZone,
	type FreeSlotQuery
} from './slots.ts';
import type { Window } from './types.ts';

const everyEvening: Window[] = [0, 1, 2, 3, 4, 5, 6].map((day) => ({ day, start: '18:00', end: '21:00' }));
const weekendDays: Window[] = [
	{ day: 6, start: '09:00', end: '20:00' },
	{ day: 0, start: '09:00', end: '20:00' }
];

function q(over: Partial<FreeSlotQuery>): FreeSlotQuery {
	return {
		now: '2026-11-02T09:00:00+05:30', // Monday
		timeZone: 'Asia/Kolkata',
		freeHours: everyEvening,
		busy: [],
		from: '2026-11-02',
		to: '2026-11-08',
		durationMinutes: 60,
		...over
	};
}

describe('time zone helpers', () => {
	it('knows Kolkata is +05:30 all year', () => {
		expect(zonedOffsetMinutes(Date.parse('2026-01-15T00:00:00Z'), 'Asia/Kolkata')).toBe(330);
		expect(zonedOffsetMinutes(Date.parse('2026-07-15T00:00:00Z'), 'Asia/Kolkata')).toBe(330);
	});

	it('tracks London DST', () => {
		expect(zonedOffsetMinutes(Date.parse('2026-01-15T12:00:00Z'), 'Europe/London')).toBe(0);
		expect(zonedOffsetMinutes(Date.parse('2026-07-15T12:00:00Z'), 'Europe/London')).toBe(60);
	});

	it('handles negative offsets', () => {
		expect(zonedOffsetMinutes(Date.parse('2026-01-15T12:00:00Z'), 'America/New_York')).toBe(-300);
		expect(zonedIso(Date.parse('2026-01-15T12:00:00Z'), 'America/New_York')).toBe('2026-01-15T07:00:00-05:00');
	});

	it('converts wall time to UTC', () => {
		expect(new Date(zonedToUtc('2026-11-07', 600, 'Asia/Kolkata')!).toISOString()).toBe('2026-11-07T04:30:00.000Z');
		expect(new Date(zonedToUtc('2026-07-01', 600, 'Europe/London')!).toISOString()).toBe('2026-07-01T09:00:00.000Z');
	});

	it('returns null for a wall time skipped by DST', () => {
		// UK clocks go 01:00 -> 02:00 on 29 Mar 2026
		expect(zonedToUtc('2026-03-29', 90, 'Europe/London')).toBeNull();
	});

	it('picks the earlier instant in a fall-back overlap', () => {
		// UK clocks go 02:00 -> 01:00 on 25 Oct 2026; 01:30 happens twice
		expect(new Date(zonedToUtc('2026-10-25', 90, 'Europe/London')!).toISOString()).toBe('2026-10-25T00:30:00.000Z');
	});

	it('supports minutes past midnight', () => {
		expect(zonedDay(zonedToUtc('2026-11-07', 25 * 60, 'Asia/Kolkata')!, 'Asia/Kolkata')).toBe('2026-11-08');
	});

	it('labels and dates', () => {
		const s = Date.parse('2026-11-07T04:30:00Z');
		expect(slotLabel(s, s + 3_600_000, 'Asia/Kolkata')).toBe('Sat 7 Nov, 10:00 to 11:00');
		expect(slotWeekday('2026-11-07')).toBe(6);
		expect(slotAddDays('2026-12-31', 1)).toBe('2027-01-01');
		expect(slotAddDays('2026-03-01', -1)).toBe('2026-02-28');
		expect(isValidTimeZone('Asia/Kolkata')).toBe(true);
		expect(isValidTimeZone('Mars/Base')).toBe(false);
	});
});

describe('freeSlots', () => {
	it('fills evening windows in Kolkata with hour slots on half hours', () => {
		const slots = freeSlots(q({ from: '2026-11-02', to: '2026-11-02' }));
		expect(slots.map((s) => s.start)).toEqual([
			'2026-11-02T18:00:00+05:30',
			'2026-11-02T18:30:00+05:30',
			'2026-11-02T19:00:00+05:30',
			'2026-11-02T19:30:00+05:30',
			'2026-11-02T20:00:00+05:30'
		]);
		expect(slots[0].end).toBe('2026-11-02T19:00:00+05:30');
		expect(slots[0].label).toBe('Mon 2 Nov, 18:00 to 19:00');
	});

	it('never offers a slot within an hour of now', () => {
		const slots = freeSlots(q({ now: '2026-11-02T17:45:00+05:30', from: '2026-11-02', to: '2026-11-02' }));
		expect(slots[0].start).toBe('2026-11-02T19:00:00+05:30');
		expect(freeSlots(q({ now: '2026-11-03T12:00:00+05:30', from: '2026-11-02', to: '2026-11-02' }))).toEqual([]);
	});

	it('skips busy times, including busy given in UTC', () => {
		const slots = freeSlots(
			q({ from: '2026-11-02', to: '2026-11-02', busy: [{ start: '2026-11-02T13:00:00Z', end: '2026-11-02T14:00:00Z' }] })
		);
		// 18:30-19:30 IST is busy, so only 20:00 fits after it ... and 18:00 does not (overlaps 18:30)
		expect(slots.map((s) => s.start.slice(11, 16))).toEqual(['19:30', '20:00']);
	});

	it('respects partOfDay and excludeWeekdays', () => {
		const slots = freeSlots(
			q({ freeHours: weekendDays, partOfDay: 'morning', excludeWeekdays: [0], durationMinutes: 90 })
		);
		expect(slots.length).toBeGreaterThan(0);
		for (const s of slots) {
			expect(s.label.startsWith('Sat')).toBe(true);
			expect(s.start >= '2026-11-07T09:00').toBe(true);
			expect(s.end <= '2026-11-07T12:00:00+05:30').toBe(true);
		}
		expect(slots.at(-1)!.start).toBe('2026-11-07T10:30:00+05:30');
	});

	it('evening part clips to 17-22', () => {
		const slots = freeSlots(q({ freeHours: weekendDays, partOfDay: 'evening', from: '2026-11-07', to: '2026-11-07' }));
		expect(slots.map((s) => s.start.slice(11, 16))).toEqual(['17:00', '17:30', '18:00', '18:30', '19:00']);
	});

	it('returns nothing when the window is shorter than the duration', () => {
		expect(freeSlots(q({ durationMinutes: 240 }))).toEqual([]);
	});

	it('handles windows that run past midnight', () => {
		const slots = freeSlots(
			q({ freeHours: [{ day: 5, start: '22:00', end: '00:30' }], from: '2026-11-06', to: '2026-11-06' })
		);
		expect(slots.map((s) => s.start)).toEqual(['2026-11-06T22:00:00+05:30', '2026-11-06T22:30:00+05:30', '2026-11-06T23:00:00+05:30', '2026-11-06T23:30:00+05:30']);
		expect(slots.at(-1)!.end).toBe('2026-11-07T00:30:00+05:30');
	});

	it('keeps local wall times across a DST change (New York, Nov 1 2026)', () => {
		const slots = freeSlots({
			now: '2026-10-30T09:00:00-04:00',
			timeZone: 'America/New_York',
			freeHours: everyEvening,
			busy: [],
			from: '2026-10-31',
			to: '2026-11-02',
			durationMinutes: 60
		}).filter((s) => s.start.slice(11, 16) === '18:00');
		expect(slots.map((s) => s.start)).toEqual([
			'2026-10-31T18:00:00-04:00',
			'2026-11-01T18:00:00-05:00',
			'2026-11-02T18:00:00-05:00'
		]);
	});

	it('handles a window inside the spring-forward gap (London)', () => {
		const slots = freeSlots({
			now: '2026-03-27T09:00:00Z',
			timeZone: 'Europe/London',
			freeHours: [{ day: 0, start: '01:00', end: '04:00' }],
			busy: [],
			from: '2026-03-29',
			to: '2026-03-29',
			durationMinutes: 60
		});
		// 01:00-01:59 does not exist that night; the window starts at 02:00 BST.
		expect(slots.map((s) => s.start)).toEqual([
			'2026-03-29T02:00:00+01:00',
			'2026-03-29T02:30:00+01:00',
			'2026-03-29T03:00:00+01:00'
		]);
	});

	it('ignores bad input', () => {
		expect(freeSlots(q({ timeZone: 'Nope/Nowhere' }))).toEqual([]);
		expect(freeSlots(q({ now: 'yesterday' }))).toEqual([]);
		expect(freeSlots(q({ from: '2026/11/02' }))).toEqual([]);
		expect(freeSlots(q({ freeHours: [{ day: 1, start: 'six', end: '21:00' }] }))).toEqual([]);
	});

	it('caps very long ranges', () => {
		const slots = freeSlots(q({ from: '2026-11-02', to: '2027-12-31' }));
		expect(new Set(slots.map((s) => s.start.slice(0, 10))).size).toBeLessThanOrEqual(62);
	});
});

describe('pickSpread', () => {
	it('picks the earliest, then one two or more days later', () => {
		const slots = freeSlots(q({}));
		const two = pickSpread(slots, 2);
		expect(two).toHaveLength(2);
		expect(two[0].start).toBe('2026-11-02T18:00:00+05:30');
		expect(two[1].start).toBe('2026-11-04T18:00:00+05:30');
	});

	it('falls back to the same day, three hours apart', () => {
		const slots = freeSlots(
			q({ freeHours: [{ day: 6, start: '09:00', end: '20:00' }], from: '2026-11-07', to: '2026-11-07' })
		);
		const two = pickSpread(slots, 2);
		expect(two.map((s) => s.start.slice(11, 16))).toEqual(['09:00', '12:00']);
	});

	it('handles tiny lists', () => {
		expect(pickSpread([], 2)).toEqual([]);
		const one = freeSlots(q({ from: '2026-11-02', to: '2026-11-02' })).slice(0, 1);
		expect(pickSpread(one, 2)).toEqual(one);
	});

	it('samples evenly', () => {
		const slots = freeSlots(q({}));
		const s = sampleSlots(slots, 5);
		expect(s).toHaveLength(5);
		expect(s[0]).toBe(slots[0]);
		expect(sampleSlots(slots.slice(0, 3), 5)).toHaveLength(3);
	});
});
