// Weekend planning maths over the Kizuna map: shared windows, time zones and quiet hours.
// Pure and deterministic. The relay runs the weekend tools with these helpers, uses
// bestWeekendSlot() when the model fails, and the app can call it offline.
import type { Slot } from './types.ts';
import type { CircleWindow, Occasion, WeekendInput, WeekendOutput } from './circle.ts';
import { isValidTimeZone, slotAddDays, slotLabel, slotWeekday, zonedDay, zonedToUtc, zonedWallTime, zonedIso } from './slots.ts';

/** The user's own id in tool calls and candidates (people ids come from WeekendInput.people). */
export const ME = 'me';
/** Length of a suggested call, when the shared time allows it. */
export const CALL_MINUTES = 60;
/** How far ahead anything is planned. */
export const WEEKEND_HORIZON_DAYS = 7;

const MIN = 60_000;
const DAY = 86_400_000;
const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

type Span = [number, number];

interface Member {
	id: string;
	timeZone: string;
	windows: CircleWindow[];
	quietStart: string;
	quietEnd: string;
}

/** A time when the user and at least one other person are free together. */
export interface WeekendCandidate {
	start: number; // ms
	end: number; // ms
	personIds: string[]; // other people free then (never includes ME)
}

function hhmm(s: string | undefined, fallback: number): number {
	const m = /^(\d{1,2}):(\d{2})$/.exec(s ?? '');
	if (!m) return fallback;
	const v = Number(m[1]) * 60 + Number(m[2]);
	return v >= 0 && v <= 24 * 60 ? v : fallback;
}

function members(input: WeekendInput): Member[] {
	return [
		{ id: ME, timeZone: input.timeZone, windows: input.me.windows, quietStart: input.me.quietStart, quietEnd: input.me.quietEnd },
		...input.people.map((p) => ({ id: p.id, timeZone: p.timeZone, windows: p.windows, quietStart: p.quietStart, quietEnd: p.quietEnd }))
	];
}

function memberById(input: WeekendInput, id: string): Member | undefined {
	return members(input).find((m) => m.id === id);
}

/** True when `ms` falls inside quiet hours (default 22:00 to 08:00) in `timeZone`. */
export function isQuietAt(ms: number, timeZone: string, quietStart?: string, quietEnd?: string): boolean {
	const a = hhmm(quietStart, 22 * 60);
	const b = hhmm(quietEnd, 8 * 60);
	if (a === b) return false;
	const w = zonedWallTime(ms, timeZone);
	const m = w.hour * 60 + w.minute;
	return a < b ? m >= a && m < b : m >= a || m < b;
}

function quietSpans(m: Member, from: number, to: number): Span[] {
	const a = hhmm(m.quietStart, 22 * 60);
	let b = hhmm(m.quietEnd, 8 * 60);
	if (a === b) return [];
	if (b <= a) b += 24 * 60;
	const out: Span[] = [];
	const last = zonedDay(to, m.timeZone);
	for (let day = zonedDay(from - DAY, m.timeZone), i = 0; day <= last && i < 40; day = slotAddDays(day, 1), i++) {
		const s = zonedToUtc(day, a, m.timeZone) ?? zonedToUtc(day, a + 60, m.timeZone);
		const e = zonedToUtc(day, b, m.timeZone) ?? zonedToUtc(day, b + 60, m.timeZone);
		if (s != null && e != null && e > s) out.push([s, e]);
	}
	return out;
}

function merge(spans: Span[]): Span[] {
	const sorted = spans.filter(([s, e]) => e > s).sort((x, y) => x[0] - y[0]);
	const out: Span[] = [];
	for (const [s, e] of sorted) {
		const last = out[out.length - 1];
		if (last && s <= last[1]) last[1] = Math.max(last[1], e);
		else out.push([s, e]);
	}
	return out;
}

function subtract(spans: Span[], cuts: Span[]): Span[] {
	let out = spans;
	for (const [cs, ce] of cuts) {
		const next: Span[] = [];
		for (const [s, e] of out) {
			if (ce <= s || cs >= e) next.push([s, e]);
			else {
				if (cs > s) next.push([s, cs]);
				if (ce < e) next.push([ce, e]);
			}
		}
		out = next;
	}
	return out;
}

/** A person's free time in [from, to): their shared windows, minus their quiet hours. */
function freeSpans(m: Member, from: number, to: number): Span[] {
	if (!isValidTimeZone(m.timeZone)) return [];
	const raw: Span[] = [];
	for (const w of m.windows ?? []) {
		const s = Date.parse(w?.start);
		const e = Date.parse(w?.end);
		if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) continue;
		raw.push([Math.max(s, from), Math.min(e, to)]);
	}
	return subtract(merge(raw), quietSpans(m, from, to));
}

function spanCovering(spans: Span[], s: number, e: number): Span | undefined {
	return spans.find(([a, b]) => a <= s && b >= e);
}

/** True when the member is free for all of [s, e): inside a shared window and outside quiet hours. */
function freeFor(m: Member, s: number, e: number): boolean {
	return !!spanCovering(freeSpans(m, s - DAY, e + DAY), s, e);
}

export interface CandidateQuery {
	from: number; // ms
	to: number; // ms
	personIds?: string[]; // only these people (default: everyone)
	minMinutes?: number; // default input.minMinutes
	limit?: number; // default 40
}

/**
 * Times the user and at least one other person are free together for at least minMinutes,
 * outside everyone's quiet hours. Each is at most CALL_MINUTES long; long overlaps also offer
 * later starts an hour apart. Biggest groups first, then soonest.
 */
export function weekendCandidates(input: WeekendInput, q: CandidateQuery): WeekendCandidate[] {
	const minMs = Math.max(15, q.minMinutes ?? input.minMinutes ?? 45) * MIN;
	const want = q.personIds ? new Set(q.personIds) : null;
	const all = members(input).filter((m) => m.id === ME || !want || want.has(m.id));
	const free = new Map(all.map((m) => [m.id, freeSpans(m, q.from, q.to)] as const));
	const mine = free.get(ME) ?? [];
	if (!mine.length) return [];
	const starts = [...new Set([...free.values()].flat().map(([s]) => s))].sort((a, b) => a - b);
	const out: WeekendCandidate[] = [];
	const seen = new Set<string>();
	const push = (c: WeekendCandidate) => {
		const k = `${c.start}|${c.personIds.join(',')}`;
		if (!seen.has(k)) {
			seen.add(k);
			out.push(c);
		}
	};
	for (const t of starts) {
		const my = spanCovering(mine, t, t + minMs);
		if (!my) continue;
		let common = my[1];
		const group: string[] = [];
		for (const m of all) {
			if (m.id === ME) continue;
			const sp = spanCovering(free.get(m.id) ?? [], t, t + minMs);
			if (sp) {
				group.push(m.id);
				common = Math.min(common, sp[1]);
			}
		}
		if (!group.length) continue;
		for (let s = t, i = 0; s + minMs <= common && i < 12; s += CALL_MINUTES * MIN, i++) {
			push({ start: s, end: Math.min(s + CALL_MINUTES * MIN, common), personIds: group });
		}
	}
	out.sort((a, b) => b.personIds.length - a.personIds.length || a.start - b.start);
	return out.slice(0, q.limit ?? 40);
}

/** The coming weekend's Saturday and Sunday in the user's zone (this one if it is already the weekend). */
export function comingWeekend(today: string): { sat: string; sun: string } {
	const wd = slotWeekday(today);
	const sat = wd === 0 ? slotAddDays(today, -1) : slotAddDays(today, 6 - wd);
	return { sat, sun: slotAddDays(sat, 1) };
}

/** [from, to) in ms for the coming weekend, never before now and never past the 7-day horizon. */
export function weekendRange(input: WeekendInput): { from: number; to: number } {
	const now = Date.parse(input.now);
	const { sat, sun } = comingWeekend(zonedDay(now, input.timeZone));
	const from = Math.max(now, zonedToUtc(sat, 0, input.timeZone) ?? now);
	const to = Math.min(now + WEEKEND_HORIZON_DAYS * DAY, zonedToUtc(slotAddDays(sun, 1), 0, input.timeZone) ?? now + WEEKEND_HORIZON_DAYS * DAY);
	return { from, to: Math.max(from, to) };
}

/** Weekdays the request rules out ("not Sunday", "Sunday nahi", "except Saturday"). */
export function excludedWeekdays(request: string): number[] {
	const r = (request ?? '').toLowerCase();
	const days: [number, string][] = [
		[6, 'sat(?:urday)?|shanivar'],
		[0, 'sun(?:day)?|ravivar|itvaar']
	];
	const out: number[] = [];
	for (const [n, re] of days) {
		if (new RegExp(`\\b(?:not|no|except|but not|skip)\\s+(?:on\\s+)?(?:${re})\\b|\\b(?:${re})\\s+(?:ko\\s+)?(?:nahi|not|no)\\b`).test(r)) out.push(n);
	}
	return out;
}

export function toSlot(c: { start: number; end: number }, timeZone: string): Slot {
	return { start: zonedIso(c.start, timeZone), end: zonedIso(c.end, timeZone), label: slotLabel(c.start, c.end, timeZone) };
}

function city(timeZone: string): string {
	return (timeZone.split('/').pop() ?? timeZone).replace(/_/g, ' ');
}

function pad(n: number): string {
	return String(n).padStart(2, '0');
}

/** 'HH:MM', weekday and quiet flag for a person (or ME) at an instant. */
export function localTimeFor(input: WeekendInput, personId: string, at: number): { local: string; weekday: string; day: string; timeZone: string; quiet: boolean } | null {
	const m = memberById(input, personId);
	if (!m || !isValidTimeZone(m.timeZone) || !Number.isFinite(at)) return null;
	const w = zonedWallTime(at, m.timeZone);
	const day = zonedDay(at, m.timeZone);
	return { local: `${pad(w.hour)}:${pad(w.minute)}`, weekday: WEEKDAY_NAMES[slotWeekday(day)], day, timeZone: m.timeZone, quiet: isQuietAt(at, m.timeZone, m.quietStart, m.quietEnd) };
}

/**
 * Checks a slot against everyone's windows and quiet hours. Returns the people (from `personIds`,
 * known ids only) who really are free for the whole slot, and whether the user is too.
 */
export function checkWeekendSlot(input: WeekendInput, slot: { start: string; end: string }, personIds: string[]): { meFree: boolean; personIds: string[] } {
	const s = Date.parse(slot.start);
	const e = Date.parse(slot.end);
	const now = Date.parse(input.now);
	if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s || s < now - 5 * MIN || e > now + (WEEKEND_HORIZON_DAYS + 1) * DAY) {
		return { meFree: false, personIds: [] };
	}
	const me = memberById(input, ME)!;
	const ok: string[] = [];
	for (const id of personIds) {
		if (id === ME || ok.includes(id)) continue;
		const m = memberById(input, id);
		if (m && freeFor(m, s, e)) ok.push(id);
	}
	return { meFree: freeFor(me, s, e), personIds: ok };
}

/** Why someone isn't in the slot, in plain words. */
export function whyNotFree(input: WeekendInput, personId: string, at: number): string {
	const t = localTimeFor(input, personId, at);
	if (!t) return 'Not free then.';
	if (t.quiet) return `It's ${t.local} in ${city(t.timeZone)} then.`;
	return 'Not free then.';
}

function partOfDay(ms: number, timeZone: string): string {
	const h = zonedWallTime(ms, timeZone).hour;
	return h < 12 ? 'morning' : h < 17 ? 'afternoon' : h < 21 ? 'evening' : 'night';
}

/** The occasion a slot is built around: one on the slot's day first, else the next one in range. */
export function occasionFor(input: WeekendInput, slotStart: number, range: { from: number; to: number }, personIds: string[] = []): Occasion | null {
	const day = zonedDay(slotStart, input.timeZone);
	const fromDay = zonedDay(range.from, input.timeZone);
	const toDay = zonedDay(range.to, input.timeZone);
	const relevant = (o: Occasion) => !o.personIds?.length || o.personIds.some((id) => personIds.includes(id) || id === ME);
	const list = (input.occasions ?? []).filter(relevant);
	return list.find((o) => o.day === day) ?? list.filter((o) => o.day >= fromDay && o.day <= toDay).sort((a, b) => a.day.localeCompare(b.day))[0] ?? null;
}

/** One kind reason line for a slot. */
export function reasonFor(input: WeekendInput, c: WeekendCandidate, occasion: Occasion | null): string {
	if (occasion) {
		if (occasion.day === zonedDay(c.start, input.timeZone)) return `It's ${occasion.name} ${partOfDay(c.start, input.timeZone)}.`;
		return `${occasion.name} is on ${WEEKDAY_NAMES[slotWeekday(occasion.day)]}.`;
	}
	const line = (input.reasons ?? []).find((r) => c.personIds.includes(r.personId) && r.text.trim());
	if (line) return line.text.trim().slice(0, 160);
	return c.personIds.length === 1 ? "You're both free then." : "You're all free then.";
}

function score(input: WeekendInput, c: WeekendCandidate): number {
	const day = zonedDay(c.start, input.timeZone);
	const onOccasion = (input.occasions ?? []).some((o) => o.day === day) ? 3 : 0;
	const everyoneAwake = [ME, ...c.personIds].every((id) => {
		const m = memberById(input, id);
		if (!m) return false;
		const h = zonedWallTime(c.start, m.timeZone).hour;
		return h >= 9 && h < 21;
	})
		? 1
		: 0;
	return c.personIds.length * 10 + onOccasion + everyoneAwake;
}

/** Best alternative for one person: the soonest time they and the user share, away from `avoid`. */
export function altSlotFor(input: WeekendInput, personId: string, range: { from: number; to: number }, avoid?: { start: number; end: number }): Slot | null {
	const c = weekendCandidates(input, { ...range, personIds: [personId] })
		.filter((x) => !avoid || x.end <= avoid.start || x.start >= avoid.end)
		.sort((a, b) => a.start - b.start)[0];
	return c ? toSlot(c, input.timeZone) : null;
}

/** People with any shared free time in the range (others only). */
function sharedAnything(input: WeekendInput, range: { from: number; to: number }): string[] {
	return input.people.filter((p) => freeSpans({ ...p }, range.from, range.to).length > 0).map((p) => p.id);
}

/** Builds the full answer around one candidate (or none). */
export function weekendAnswer(input: WeekendInput, c: WeekendCandidate | null, range = weekendRange(input)): WeekendOutput {
	if (!c) return { slot: null, personIds: [], skipped: [], reason: 'Nothing lines up this weekend.', occasion: null, tools_used: [] };
	const occasion = occasionFor(input, c.start, range, c.personIds);
	const skipped = sharedAnything(input, range)
		.filter((id) => !c.personIds.includes(id))
		.map((id) => ({ personId: id, why: whyNotFree(input, id, c.start), alt: altSlotFor(input, id, range, c) }));
	return {
		slot: toSlot(c, input.timeZone),
		personIds: c.personIds,
		skipped,
		reason: reasonFor(input, c, occasion),
		occasion: occasion?.name ?? null,
		tools_used: []
	};
}

/**
 * The weekend plan without a model: the coming weekend's time with the most people free
 * (user + at least one other, each slot >= minMinutes, outside everyone's quiet hours),
 * preferring an occasion day, then daytime for everyone, then sooner. Honours "not Sunday".
 * slot is null when nothing fits. tools_used is empty.
 */
export function bestWeekendSlot(input: WeekendInput): WeekendOutput {
	if (!Number.isFinite(Date.parse(input.now)) || !isValidTimeZone(input.timeZone)) return weekendAnswer(input, null, { from: 0, to: 0 });
	const range = weekendRange(input);
	const skip = excludedWeekdays(input.request);
	const cands = weekendCandidates(input, range).filter((c) => !skip.includes(slotWeekday(zonedDay(c.start, input.timeZone))));
	let best: WeekendCandidate | null = null;
	let bestScore = -1;
	for (const c of cands) {
		const s = score(input, c);
		if (s > bestScore || (s === bestScore && best && c.start < best.start)) {
			best = c;
			bestScore = s;
		}
	}
	return weekendAnswer(input, best, range);
}
