import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '../db.ts';
import { FESTIVALS, nextOccurrence, occasionsBetween, upcomingOccasions } from './occasions.ts';
import { resetDb } from './testing.ts';

const weekday = (day: string) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(`${day}T12:00:00Z`).getUTCDay()];
const find = (name: string, year: string) => FESTIVALS.find((o) => o.name === name && o.day.startsWith(year))!;

beforeEach(async () => {
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(new Date(2026, 9, 26, 10, 0));
	await resetDb();
});
afterEach(() => vi.useRealTimers());

describe('festival table', () => {
	it('has the checked dates and weekdays', () => {
		expect([find('Thanksgiving', '2026').day, weekday(find('Thanksgiving', '2026').day)]).toEqual(['2026-11-26', 'Thu']);
		expect([find('Thanksgiving', '2027').day, weekday('2027-11-25')]).toEqual(['2027-11-25', 'Thu']);
		expect([find("Mother's Day", '2027').day, weekday('2027-05-09')]).toEqual(['2027-05-09', 'Sun']);
		expect([find("Father's Day", '2027').day, weekday('2027-06-20')]).toEqual(['2027-06-20', 'Sun']);
		expect(find('Christmas', '2026').day).toBe('2026-12-25');
		expect(find("New Year's Day", '2027').day).toBe('2027-01-01');
	});
	it('keeps to days shared widely, no regional festival list', () => {
		expect(FESTIVALS.length).toBeLessThanOrEqual(12);
		for (const o of FESTIVALS) expect(o.region ?? 'US').toBe('US');
	});
	it('is in date order, valid days, festivals for everyone', () => {
		for (let i = 1; i < FESTIVALS.length; i++) expect(FESTIVALS[i - 1].day <= FESTIVALS[i].day).toBe(true);
		for (const o of FESTIVALS) {
			expect(o.day).toMatch(/^20(26|27)-\d{2}-\d{2}$/);
			expect(Number.isNaN(Date.parse(o.day))).toBe(false);
			expect(o.personIds).toEqual([]);
		}
	});
});

describe('occasions', () => {
	it('birthdays come round each year', () => {
		expect(nextOccurrence('2026-11-04', '2026-10-26')).toBe('2026-11-04');
		expect(nextOccurrence('1966-11-04', '2026-10-26')).toBe('2026-11-04');
		expect(nextOccurrence('2026-03-01', '2026-10-26')).toBe('2027-03-01');
		expect(nextOccurrence('2024-02-29', '2027-01-10')).toBe('2027-02-28');
	});
	it('merges the table with birthdays, soonest first', () => {
		const bday = { day: '2026-11-20', name: "Dad's birthday", kind: 'birthday' as const, personIds: ['dad'] };
		const list = occasionsBetween([bday], '2026-11-15', 14);
		expect(list.map((o) => o.name)).toEqual(["Dad's birthday", 'Thanksgiving']);
		expect(occasionsBetween([bday], '2026-11-15', 5).map((o) => o.name)).toEqual(["Dad's birthday"]);
	});
	it('reads stored birthdays', async () => {
		await db.occasions.put({ id: 'birthday:dad', day: '2026-11-04', name: "Dad's birthday", kind: 'birthday', personIds: ['dad'] });
		const list = await upcomingOccasions(10);
		expect(list.find((o) => o.kind === 'birthday')).toEqual({ day: '2026-11-04', name: "Dad's birthday", kind: 'birthday', personIds: ['dad'] });
	});
});
