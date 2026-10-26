// Time in someone else's zone. Pure.
import { isValidTimeZone, zonedWallTime } from '@kizuna/shared';

const pad = (n: number) => String(n).padStart(2, '0');

export const DEFAULT_QUIET_START = '22:00';
export const DEFAULT_QUIET_END = '08:00';

const mins = (hhmm: string) => {
	const [h, m] = hhmm.split(':').map(Number);
	return (h || 0) * 60 + (m || 0);
};

/** 'HH:MM' in `tz` at instant `ms` (null for an unknown zone). */
export function zonedClock(ms: number, tz: string): string | null {
	if (!isValidTimeZone(tz)) return null;
	const w = zonedWallTime(ms, tz);
	return `${pad(w.hour)}:${pad(w.minute)}`;
}

/** Minutes since local midnight in `tz`. */
export function zonedMinutes(ms: number, tz: string): number {
	const w = zonedWallTime(ms, tz);
	return w.hour * 60 + w.minute;
}

/** True when instant `ms` is inside quiet hours in `tz` (quiet hours may wrap past midnight). */
export function quietAt(ms: number, tz: string, quietStart = DEFAULT_QUIET_START, quietEnd = DEFAULT_QUIET_END): boolean {
	if (!isValidTimeZone(tz)) return false;
	const t = zonedMinutes(ms, tz);
	const s = mins(quietStart);
	const e = mins(quietEnd);
	if (s === e) return false;
	return s < e ? t >= s && t < e : t >= s || t < e;
}

/** True when any part of [start, end) is in quiet hours. Checked every 15 minutes. */
export function rangeTouchesQuiet(start: number, end: number, tz: string, quietStart?: string, quietEnd?: string): boolean {
	for (let t = start; t < end; t += 15 * 60_000) if (quietAt(t, tz, quietStart, quietEnd)) return true;
	return quietAt(end - 60_000, tz, quietStart, quietEnd);
}

/** 0 at night, rising through the morning to 1 at midday, falling to 0 by about 19:00. */
export function daylightAt(minutes: number): number {
	const h = minutes / 60;
	if (h <= 6 || h >= 19) return 0;
	const v = Math.sin((Math.PI * (h - 6)) / 13);
	return Math.round(Math.max(0, Math.min(1, v)) * 100) / 100;
}
