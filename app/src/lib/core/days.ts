// Local-time day helpers. A "day" is 'YYYY-MM-DD' in the phone's time zone.

const pad = (n: number) => String(n).padStart(2, '0');

export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function localDay(d: Date | string = new Date()): string {
	const x = typeof d === 'string' ? new Date(d) : d;
	return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`;
}

export function localTime(d: Date | string): string {
	const x = typeof d === 'string' ? new Date(d) : d;
	return `${pad(x.getHours())}:${pad(x.getMinutes())}`;
}

/** Local midnight (or the given 'HH:MM') of a day. */
export function dayToDate(day: string, time = '00:00'): Date {
	const [y, m, d] = day.split('-').map(Number);
	const [hh, mm] = time.split(':').map(Number);
	return new Date(y, m - 1, d, hh || 0, mm || 0, 0, 0);
}

export function addDays(day: string, n: number): string {
	const d = dayToDate(day);
	d.setDate(d.getDate() + n);
	return localDay(d);
}

/** Whole days from a to b (b - a). */
export function dayDiff(a: string, b: string): number {
	return Math.round((dayToDate(b).getTime() - dayToDate(a).getTime()) / 86_400_000);
}

export function weekdayOf(day: string): number {
	return dayToDate(day).getDay();
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
	const off = -d.getTimezoneOffset();
	const sign = off >= 0 ? '+' : '-';
	const a = Math.abs(off);
	return `${localDay(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${sign}${pad(Math.floor(a / 60))}:${pad(a % 60)}`;
}

/** True when the time of `now` falls inside quiet hours (which may wrap past midnight). */
export function inQuietHours(now: Date, quietStart: string, quietEnd: string): boolean {
	const t = now.getHours() * 60 + now.getMinutes();
	const s = minutesOf(quietStart);
	const e = minutesOf(quietEnd);
	if (s === e) return false;
	return s < e ? t >= s && t < e : t >= s || t < e;
}

export function partOfDay(d: Date): 'morning' | 'afternoon' | 'evening' {
	const h = d.getHours();
	return h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening';
}

/** "this evening", "tomorrow morning", "Thursday evening" */
export function slotPhrase(start: Date, now: Date): string {
	const diff = dayDiff(localDay(now), localDay(start));
	const part = partOfDay(start);
	if (diff === 0) return `this ${part}`;
	if (diff === 1) return `tomorrow ${part}`;
	return `${WEEKDAYS[start.getDay()]} ${part}`;
}

/** "today", "tomorrow", "yesterday", "on Thursday" (no day counts). */
export function dayPhrase(day: string, today: string): string {
	const d = dayDiff(today, day);
	if (d === 0) return 'today';
	if (d === 1) return 'tomorrow';
	if (d === -1) return 'yesterday';
	if (Math.abs(d) < 7) return `on ${weekdayName(day)}`;
	const dt = dayToDate(day);
	return `on ${dt.getDate()} ${dt.toLocaleString('en-GB', { month: 'short' })}`;
}

export function slotLabel(start: Date, end: Date): string {
	const wd = WEEKDAYS[start.getDay()].slice(0, 3);
	const mon = start.toLocaleString('en-GB', { month: 'short' });
	return `${wd} ${start.getDate()} ${mon}, ${localTime(start)} to ${localTime(end)}`;
}

export function deviceTimeZone(): string {
	try {
		return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
	} catch {
		return 'UTC';
	}
}
