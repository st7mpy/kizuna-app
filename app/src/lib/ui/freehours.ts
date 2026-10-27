// Free hours in Settings: where a new window goes, and whether an edited one makes sense.
import type { Window } from '@kizuna/shared';

const toMin = (hhmm: string) => {
	const [h, m] = hhmm.split(':').map(Number);
	return (h || 0) * 60 + (m || 0);
};
const toClock = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

const LAST = 23 * 60 + 30; // the latest a window can end
const MIN_LEN = 60;

/** Times offered in the pickers: every 30 minutes, plus any odd time already saved. */
export function timeOptions(extra: string[] = []): string[] {
	const all = new Set<string>();
	for (let m = 0; m <= LAST; m += 30) all.add(toClock(m));
	for (const x of extra) if (/^\d\d:\d\d$/.test(x)) all.add(x);
	return [...all].sort();
}

/**
 * Pure: a new window for a day that doesn't overlap the ones it has: two hours from the usual start
 * (18:30 on weekdays, 10:00 at the weekend) or the first free gap after it, else the first gap of the day.
 * Null when there is no free hour left.
 */
export function newWindow(day: number, existing: Pick<Window, 'start' | 'end'>[]): { start: string; end: string } | null {
	const taken = existing.map((w) => [toMin(w.start), toMin(w.end)] as const).sort((a, b) => a[0] - b[0]);
	const usual = day === 0 || day === 6 ? 10 * 60 : 18 * 60 + 30;
	const fits = (s: number) => {
		if (s + MIN_LEN > LAST) return null;
		if (taken.some(([a, b]) => s < b && s + MIN_LEN > a)) return null;
		const next = taken.map(([a]) => a).filter((a) => a >= s + MIN_LEN).sort((a, b) => a - b)[0] ?? LAST;
		return { start: toClock(s), end: toClock(Math.min(s + 120, next, LAST)) };
	};
	const starts = [usual, ...taken.map(([, b]) => b).filter((b) => b >= usual), 7 * 60, ...taken.map(([, b]) => b)];
	for (const s of starts) {
		const w = fits(s);
		if (w) return w;
	}
	for (let s = 7 * 60; s <= LAST; s += 30) {
		const w = fits(s);
		if (w) return w;
	}
	return null;
}

/** Pure: what's wrong with a window, in plain words, or null when it's fine. */
export function windowProblem(w: Pick<Window, 'start' | 'end'>, others: Pick<Window, 'start' | 'end'>[]): string | null {
	const s = toMin(w.start);
	const e = toMin(w.end);
	if (e <= s) return 'The end needs to be after the start.';
	if (others.some((o) => s < toMin(o.end) && e > toMin(o.start))) return 'This overlaps another time on the same day.';
	return null;
}
