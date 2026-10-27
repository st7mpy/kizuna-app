// Free-slot maths shared by the relay's plan tools and the app's offline fallback.
// Owner: relay (plan task). Pure functions only, no dependencies: time zones via Intl.
import type { Slot, Window } from './types.ts';

export type PartOfDay = 'morning' | 'afternoon' | 'evening';

export interface FreeSlotQuery {
	now: string; // ISO with offset
	timeZone: string;
	freeHours: Window[];
	busy: { start: string; end: string }[];
	from: string; // 'YYYY-MM-DD'
	to: string; // 'YYYY-MM-DD'
	durationMinutes: number;
	partOfDay?: PartOfDay | null;
	excludeWeekdays?: number[]; // 0 = Sunday
	/** Minutes between candidate starts (default 30). */
	stepMinutes?: number;
	/** Minimum lead time from now, in minutes (default 60). */
	bufferMinutes?: number;
}

export const PART_OF_DAY: Record<PartOfDay, [number, number]> = {
	morning: [6 * 60, 12 * 60],
	afternoon: [12 * 60, 17 * 60],
	evening: [17 * 60, 22 * 60]
};

const DAY_MS = 86_400_000;
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(timeZone: string): Intl.DateTimeFormat {
	// Keyed by lower-case name: zone names ignore case, so spellings must not each add an entry.
	const key = timeZone.toLowerCase();
	let f = formatters.get(key);
	if (!f) {
		f = new Intl.DateTimeFormat('en-US', {
			timeZone,
			hourCycle: 'h23',
			year: 'numeric',
			month: 'numeric',
			day: 'numeric',
			hour: 'numeric',
			minute: 'numeric',
			second: 'numeric'
		});
		formatters.set(key, f);
	}
	return f;
}

export function isValidTimeZone(timeZone: string): boolean {
	if (typeof timeZone !== 'string' || !timeZone || timeZone.length > 64) return false;
	try {
		formatter(timeZone);
		return true;
	} catch {
		return false;
	}
}

export interface WallTime { year: number; month: number; day: number; hour: number; minute: number; second: number }

/** Wall-clock time in `timeZone` at the instant `ms`. */
export function zonedWallTime(ms: number, timeZone: string): WallTime {
	const parts: Record<string, number> = {};
	for (const p of formatter(timeZone).formatToParts(new Date(ms))) {
		if (p.type !== 'literal') parts[p.type] = Number(p.value);
	}
	return {
		year: parts.year,
		month: parts.month,
		day: parts.day,
		hour: parts.hour === 24 ? 0 : parts.hour,
		minute: parts.minute,
		second: parts.second
	};
}

/** Offset of `timeZone` from UTC at instant `ms`, in minutes (America/New_York = -240 in summer). */
export function zonedOffsetMinutes(ms: number, timeZone: string): number {
	const w = zonedWallTime(ms, timeZone);
	const asUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
	return Math.round((asUtc - Math.floor(ms / 1000) * 1000) / 60_000);
}

/**
 * UTC instant for a local wall time in `timeZone`. Minutes may run past the day
 * (1500 = 01:00 next day). Returns null when the wall time does not exist
 * (skipped by a DST jump). Ambiguous times pick the earlier instant.
 */
export function zonedToUtc(day: string, minutes: number, timeZone: string): number | null {
	const [y, m, d] = day.split('-').map(Number);
	const guess = Date.UTC(y, m - 1, d, 0, minutes);
	const o1 = zonedOffsetMinutes(guess, timeZone);
	const t1 = guess - o1 * 60_000;
	const o2 = zonedOffsetMinutes(t1, timeZone);
	let t = o1 === o2 ? t1 : guess - o2 * 60_000;
	if (!sameWall(t, guess, timeZone)) return null;
	// In a fall-back overlap the same wall time happens twice; take the first.
	for (const back of [30, 60, 120]) {
		const earlier = t - back * 60_000;
		if (sameWall(earlier, guess, timeZone)) {
			t = earlier;
			break;
		}
	}
	return t;
}

function sameWall(ms: number, wallAsUtc: number, timeZone: string): boolean {
	const w = zonedWallTime(ms, timeZone);
	return Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute) === wallAsUtc;
}

function pad(n: number): string {
	return String(n).padStart(2, '0');
}

/** 'YYYY-MM-DD' in `timeZone` for instant `ms`. */
export function zonedDay(ms: number, timeZone: string): string {
	const w = zonedWallTime(ms, timeZone);
	return `${w.year}-${pad(w.month)}-${pad(w.day)}`;
}

/** ISO string with the zone's offset, e.g. '2026-11-07T10:00:00+05:30'. */
export function zonedIso(ms: number, timeZone: string): string {
	const w = zonedWallTime(ms, timeZone);
	const off = zonedOffsetMinutes(ms, timeZone);
	const sign = off < 0 ? '-' : '+';
	const a = Math.abs(off);
	return `${w.year}-${pad(w.month)}-${pad(w.day)}T${pad(w.hour)}:${pad(w.minute)}:${pad(w.second)}${sign}${pad(Math.floor(a / 60))}:${pad(a % 60)}`;
}

/** 'Sat 7 Nov, 10:00 to 11:00' in `timeZone`. */
export function slotLabel(startMs: number, endMs: number, timeZone: string): string {
	const s = zonedWallTime(startMs, timeZone);
	const e = zonedWallTime(endMs, timeZone);
	const wd = new Date(Date.UTC(s.year, s.month - 1, s.day)).getUTCDay();
	return `${WEEKDAYS[wd]} ${s.day} ${MONTHS[s.month - 1]}, ${pad(s.hour)}:${pad(s.minute)} to ${pad(e.hour)}:${pad(e.minute)}`;
}

/** Day of week (0 = Sunday) of a 'YYYY-MM-DD' date. */
export function slotWeekday(day: string): number {
	const [y, m, d] = day.split('-').map(Number);
	return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** 'YYYY-MM-DD' plus n days. */
export function slotAddDays(day: string, n: number): string {
	const [y, m, d] = day.split('-').map(Number);
	return new Date(Date.UTC(y, m - 1, d) + n * DAY_MS).toISOString().slice(0, 10);
}

function hhmm(s: string): number | null {
	const m = /^(\d{1,2}):(\d{2})$/.exec(s);
	if (!m) return null;
	const v = Number(m[1]) * 60 + Number(m[2]);
	return v >= 0 && v <= 24 * 60 ? v : null;
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** All free slots in [from, to] (inclusive local days), earliest first. */
export function freeSlots(q: FreeSlotQuery): Slot[] {
	const nowMs = Date.parse(q.now);
	if (!Number.isFinite(nowMs) || !DAY_RE.test(q.from) || !DAY_RE.test(q.to)) return [];
	if (!isValidTimeZone(q.timeZone)) return [];
	const duration = Math.max(15, Math.min(q.durationMinutes || 60, 12 * 60)) * 60_000;
	const step = Math.max(5, q.stepMinutes ?? 30) * 60_000;
	const earliest = nowMs + (q.bufferMinutes ?? 60) * 60_000;
	const exclude = new Set(q.excludeWeekdays ?? []);
	const part = q.partOfDay ? PART_OF_DAY[q.partOfDay] : null;

	const busy = (q.busy ?? [])
		.map((b) => [Date.parse(b.start), Date.parse(b.end)] as const)
		.filter(([s, e]) => Number.isFinite(s) && Number.isFinite(e) && e > s);
	const isBusy = (s: number, e: number) => busy.some(([bs, be]) => s < be && e > bs);

	const out: Slot[] = [];
	const seen = new Set<number>();
	// Cap the range so a bad request can't loop for long.
	for (let day = q.from, i = 0; day <= q.to && i < 62; day = slotAddDays(day, 1), i++) {
		const wd = slotWeekday(day);
		if (exclude.has(wd)) continue;
		const windows = (q.freeHours ?? [])
			.filter((w) => w.day === wd)
			.map((w) => {
				const s = hhmm(w.start);
				let e = hhmm(w.end);
				if (s == null || e == null) return null;
				if (e <= s) e += 24 * 60; // runs past midnight
				return [s, e] as [number, number];
			})
			.filter((w): w is [number, number] => w !== null);
		for (let [ws, we] of windows) {
			if (part) {
				ws = Math.max(ws, part[0]);
				we = Math.min(we, part[1]);
			}
			if (we - ws < duration / 60_000) continue;
			// A window edge inside a DST gap moves to the next real hour.
			const winStart = zonedToUtc(day, ws, q.timeZone) ?? zonedToUtc(day, ws + 60, q.timeZone);
			const winEnd = zonedToUtc(day, we, q.timeZone) ?? zonedToUtc(day, we + 60, q.timeZone);
			if (winStart == null || winEnd == null) continue;
			for (let s = winStart; s + duration <= winEnd; s += step) {
				const e = s + duration;
				if (s < earliest || seen.has(s) || isBusy(s, e)) continue;
				seen.add(s);
				out.push({ start: zonedIso(s, q.timeZone), end: zonedIso(e, q.timeZone), label: slotLabel(s, e, q.timeZone) });
			}
		}
	}
	return out.sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
}

/**
 * Up to n well-spread slots, earliest first: the first free slot, then others on
 * different days (two or more days apart if possible), then same-day slots at
 * least three hours apart.
 */
export function pickSpread(slots: Slot[], n = 2): Slot[] {
	if (slots.length === 0 || n <= 0) return [];
	const dayMs = (s: Slot) => Date.parse(s.start.slice(0, 10));
	const picked: Slot[] = [slots[0]];
	for (const minDays of [2, 1]) {
		for (const s of slots) {
			if (picked.length >= n) break;
			if (!picked.includes(s) && picked.every((p) => Math.abs(dayMs(s) - dayMs(p)) >= minDays * DAY_MS)) picked.push(s);
		}
	}
	for (const s of slots) {
		if (picked.length >= n) break;
		if (!picked.includes(s) && picked.every((p) => Math.abs(Date.parse(s.start) - Date.parse(p.start)) >= 3 * 3_600_000)) {
			picked.push(s);
		}
	}
	return picked.sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
}

/** At most n slots sampled evenly across the list (keeps tool results short). */
export function sampleSlots(slots: Slot[], n: number): Slot[] {
	if (slots.length <= n) return slots;
	const out: Slot[] = [];
	for (let i = 0; i < n; i++) out.push(slots[Math.floor((i * slots.length) / n)]);
	return out;
}
