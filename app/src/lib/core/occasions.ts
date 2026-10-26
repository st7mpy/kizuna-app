// Occasions: a fixed table of festivals (checked against published panchang and holiday lists)
// plus birthdays heard in notes. Festival dates can shift by a day locally.
import type { Occasion } from '@kizuna/shared';
import { db, type StoredOccasion } from '../db.ts';
import { addDays, dayDiff, localDay } from './days.ts';

const f = (day: string, name: string, region?: string): Occasion => ({ day, name, kind: 'festival', personIds: [], ...(region ? { region } : {}) });

/** Late Oct 2026 to Dec 2027. Indian dates follow the New Delhi panchang. */
export const FESTIVALS: Occasion[] = [
	f('2026-10-29', 'Karva Chauth', 'IN'),
	f('2026-11-06', 'Dhanteras', 'IN'),
	f('2026-11-08', 'Diwali', 'IN'),
	f('2026-11-10', 'Govardhan Puja', 'IN'),
	f('2026-11-11', 'Bhai Dooj', 'IN'),
	f('2026-11-15', 'Chhath Puja', 'IN'),
	f('2026-11-24', 'Guru Nanak Jayanti', 'IN'),
	f('2026-12-25', 'Christmas'),
	f('2026-12-31', "New Year's Eve"),
	f('2027-01-01', "New Year's Day"),
	f('2027-01-13', 'Lohri', 'IN'),
	f('2027-01-14', 'Makar Sankranti', 'IN'),
	f('2027-02-11', 'Vasant Panchami', 'IN'),
	f('2027-03-06', 'Maha Shivratri', 'IN'),
	f('2027-03-10', 'Eid al-Fitr', 'IN'), // depends on the moon, may move a day
	f('2027-03-21', 'Holika Dahan', 'IN'),
	f('2027-03-22', 'Holi', 'IN'),
	f('2027-04-07', 'Ugadi and Gudi Padwa', 'IN'),
	f('2027-04-15', 'Ram Navami', 'IN'),
	f('2027-05-09', "Mother's Day"),
	f('2027-05-17', 'Eid al-Adha', 'IN'), // depends on the moon
	f('2027-06-20', "Father's Day"),
	f('2027-08-17', 'Raksha Bandhan', 'IN'),
	f('2027-08-25', 'Janmashtami', 'IN'),
	f('2027-09-04', 'Ganesh Chaturthi', 'IN'),
	f('2027-09-12', 'Onam', 'IN'),
	f('2027-09-30', 'Navratri begins', 'IN'),
	f('2027-10-09', 'Dussehra', 'IN'),
	f('2027-10-18', 'Karva Chauth', 'IN'),
	f('2027-10-27', 'Dhanteras', 'IN'),
	f('2027-10-29', 'Diwali', 'IN'),
	f('2027-10-31', 'Bhai Dooj', 'IN'),
	f('2027-11-04', 'Chhath Puja', 'IN'),
	f('2027-11-14', 'Guru Nanak Jayanti', 'IN'),
	f('2027-12-25', 'Christmas'),
	f('2027-12-31', "New Year's Eve")
];

/** Festivals people often mark with a small gift. */
export const GIFT_FESTIVALS = new Set(['Diwali', 'Christmas', 'Raksha Bandhan', 'Bhai Dooj']);

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
