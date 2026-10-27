// Occasions: a short fixed table of widely shared days, plus birthdays and
// anniversaries heard in notes. Days marked 'US' differ in other countries.
import type { Occasion } from '@kizuna/shared';
import { db, type StoredOccasion } from '../db.ts';
import { addDays, dayDiff, localDay } from './days.ts';

const f = (day: string, name: string, region?: string): Occasion => ({ day, name, kind: 'festival', personIds: [], ...(region ? { region } : {}) });

/** Late Oct 2026 to Dec 2027. */
export const FESTIVALS: Occasion[] = [
	f('2026-11-26', 'Thanksgiving', 'US'),
	f('2026-12-24', 'Christmas Eve'),
	f('2026-12-25', 'Christmas'),
	f('2026-12-31', "New Year's Eve"),
	f('2027-01-01', "New Year's Day"),
	f('2027-05-09', "Mother's Day", 'US'),
	f('2027-06-20', "Father's Day", 'US'),
	f('2027-11-25', 'Thanksgiving', 'US'),
	f('2027-12-24', 'Christmas Eve'),
	f('2027-12-25', 'Christmas'),
	f('2027-12-31', "New Year's Eve")
];

/** Days people often mark with a small gift. */
export const GIFT_FESTIVALS = new Set(['Christmas', "Mother's Day", "Father's Day"]);

/** Birthdays and anniversaries come round every year: the next time on or after today. */
export function nextOccurrence(day: string, today: string): string {
	if (day >= today) return day;
	const [, m, d] = day.split('-');
	let year = Number(today.slice(0, 4));
	for (let i = 0; i < 2; i++, year++) {
		// 29 Feb falls back to 28 Feb in other years
		let cand = `${year}-${m}-${d}`;
		if (m === '02' && d === '29' && !(year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0))) cand = `${year}-02-28`;
		if (cand >= today) return cand;
	}
	return day;
}

/** Pure: festivals plus personal occasions in [today, today + days], soonest first. */
export function occasionsBetween(personal: Occasion[], today: string, days: number): Occasion[] {
	const end = addDays(today, days);
	const out: Occasion[] = [];
	for (const o of FESTIVALS) if (o.day >= today && o.day <= end) out.push(o);
	for (const o of personal) {
		const day = o.kind === 'birthday' || o.kind === 'anniversary' ? nextOccurrence(o.day, today) : o.day;
		if (day >= today && day <= end) out.push({ day, name: o.name, kind: o.kind, personIds: [...o.personIds], ...(o.region ? { region: o.region } : {}) });
	}
	return out.sort((a, b) => a.day.localeCompare(b.day) || a.name.localeCompare(b.name));
}

const strip = ({ id: _id, fragmentId: _f, ...o }: StoredOccasion): Occasion => o;

/** Festivals and birthdays in the next `days` days. */
export async function upcomingOccasions(days = 14, now = new Date()): Promise<Occasion[]> {
	const stored = await db.occasions.toArray();
	return occasionsBetween(stored.map(strip), localDay(now), days);
}

/** Days from today to an occasion (0 = today). */
export function daysUntil(o: Occasion, now = new Date()): number {
	return dayDiff(localDay(now), o.day);
}
