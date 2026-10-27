// Local-time day helpers. A "day" is 'YYYY-MM-DD' in the phone's time zone, or in the
// home zone when one is set (a sample family lives in its own city, wherever the visitor is).
import { zonedOffsetMinutes, zonedToUtc, zonedWallTime } from '@kizuna/shared';

const pad = (n: number) => String(n).padStart(2, '0');

let home: string | null = null;

/** Sets (or clears) the zone that "your time" means. Real users keep the phone's zone. */
export function setHomeZone(tz: string | null | undefined): void {
	home = tz || null;
}

/** The home zone when one is set, else null (meaning the phone's own zone). */
export function homeZone(): string | null {
	return home;
}

const wall = (d: Date) => zonedWallTime(d.getTime(), home!);
const toDate = (x: Date | string) => (typeof x === 'string' ? new Date(x) : x);

/** Hour of the day (0 to 23) in the home or phone zone. */
export function hourOf(d: Date = new Date()): number {
	return home ? wall(d).hour : d.getHours();
}

/** Weekday (0 = Sunday) of an instant in the home or phone zone. */
export function weekdayAt(d: Date = new Date()): number {
	return weekdayOf(localDay(d));
}

export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function localDay(d: Date | string = new Date()): string {
	const x = toDate(d);
	if (home) {
		const w = wall(x);
		return `${w.year}-${pad(w.month)}-${pad(w.day)}`;
	}
	return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`;
}

export function localTime(d: Date | string): string {
	const x = toDate(d);
	if (home) {
		const w = wall(x);
		return `${pad(w.hour)}:${pad(w.minute)}`;
	}
	return `${pad(x.getHours())}:${pad(x.getMinutes())}`;
}

/** Local midnight (or the given 'HH:MM') of a day. */
export function dayToDate(day: string, time = '00:00'): Date {
	const [y, m, d] = day.split('-').map(Number);
	const [hh, mm] = time.split(':').map(Number);
	if (home) return new Date(zonedToUtc(day, (hh || 0) * 60 + (mm || 0), home) ?? zonedToUtc(day, (hh || 0) * 60 + (mm || 0) + 60, home)!);
	return new Date(y, m - 1, d, hh || 0, mm || 0, 0, 0);
}

// Calendar maths on the day strings themselves, the same in every zone.
const utcOf = (day: string) => {
	const [y, m, d] = day.split('-').map(Number);
	return Date.UTC(y, m - 1, d);
};

export function addDays(day: string, n: number): string {
	return new Date(utcOf(day) + n * 86_400_000).toISOString().slice(0, 10);
}

/** Whole days from a to b (b - a). */
export function dayDiff(a: string, b: string): number {
	return Math.round((utcOf(b) - utcOf(a)) / 86_400_000);
}

export function weekdayOf(day: string): number {
	return new Date(utcOf(day)).getUTCDay();
}

export function weekdayName(day: string): string {
	return WEEKDAYS[weekdayOf(day)];
}

export function minutesOf(hhmm: string): number {
	const [h, m] = hhmm.split(':').map(Number);
	return (h || 0) * 60 + (m || 0);
}

/** ISO string with the local offset, e.g. 2026-10-29T18:30:00+05:30 */
export function isoWithOffset(d: Date): string {
	if (home) {
		const w = wall(d);
		const o = zonedOffsetMinutes(d.getTime(), home);
		const a = Math.abs(o);
		return `${w.year}-${pad(w.month)}-${pad(w.day)}T${pad(w.hour)}:${pad(w.minute)}:${pad(w.second)}${o < 0 ? '-' : '+'}${pad(Math.floor(a / 60))}:${pad(a % 60)}`;
	}
	const off = -d.getTimezoneOffset();
	const sign = off >= 0 ? '+' : '-';
	const a = Math.abs(off);
	return `${localDay(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${sign}${pad(Math.floor(a / 60))}:${pad(a % 60)}`;
}

/** True when the time of `now` falls inside quiet hours (which may wrap past midnight). */
export function inQuietHours(now: Date, quietStart: string, quietEnd: string): boolean {
	const t = home ? wall(now).hour * 60 + wall(now).minute : now.getHours() * 60 + now.getMinutes();
	const s = minutesOf(quietStart);
	const e = minutesOf(quietEnd);
	if (s === e) return false;
	return s < e ? t >= s && t < e : t >= s || t < e;
}

export function partOfDay(d: Date): 'morning' | 'afternoon' | 'evening' {
	const h = hourOf(d);
	return h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening';
}

/** "this evening", "tomorrow morning", "Thursday evening" */
export function slotPhrase(start: Date, now: Date): string {
	const diff = dayDiff(localDay(now), localDay(start));
	const part = partOfDay(start);
	if (diff === 0) return `this ${part}`;
	if (diff === 1) return `tomorrow ${part}`;
	return `${WEEKDAYS[weekdayAt(start)]} ${part}`;
}

/** "today", "tomorrow", "yesterday", "on Thursday" (no day counts). */
export function dayPhrase(day: string, today: string): string {
	const d = dayDiff(today, day);
	if (d === 0) return 'today';
	if (d === 1) return 'tomorrow';
	if (d === -1) return 'yesterday';
	if (Math.abs(d) < 7) return `on ${weekdayName(day)}`;
	const dt = new Date(utcOf(day));
	return `on ${dt.getUTCDate()} ${dt.toLocaleString('en-GB', { month: 'short', timeZone: 'UTC' })}`;
}

export function slotLabel(start: Date, end: Date): string {
	const day = localDay(start);
	const wd = WEEKDAYS[weekdayOf(day)].slice(0, 3);
	const dt = new Date(utcOf(day));
	const mon = dt.toLocaleString('en-GB', { month: 'short', timeZone: 'UTC' });
	return `${wd} ${dt.getUTCDate()} ${mon}, ${localTime(start)} to ${localTime(end)}`;
}

/** The zone "your time" is in: the home zone when set, else the phone's. */
export function deviceTimeZone(): string {
	if (home) return home;
	try {
		return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
	} catch {
		return 'UTC';
	}
}
