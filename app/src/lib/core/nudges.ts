// The nudge engine. Pure: give it the state and a clock, it says which cards to show.
// Rules: a person card needs a reason AND a free window; none in quiet hours; a weekly cap;
// "not now" hides a person for 3 days; no person twice; people first, then threads.
import type { KEvent, Person, Prompt, ReasonKind, Room, Settings, Slot, Thread } from '@kizuna/shared';
import { addDays, dayDiff, dayPhrase, inQuietHours, localDay, slotPhrase } from './days.ts';

export const ROOM_CARDS: Record<Room, number> = { low: 1, some: 3, lots: 5 };
export const NOT_NOW_DAYS = 3;
export const GAP_DAYS = 14;
export const JUST_REACHED_DAYS = 2;
export const EVENT_AHEAD_DAYS = 3;
export const EVENT_BEHIND_DAYS = 2;
/** Even with lots of room, at most this many people a day (the weekly cap is small). */
export const MAX_PEOPLE_PER_DAY = 3;

export interface NudgeState {
	now: Date;
	room: Room;
	settings: Pick<Settings, 'quietStart' | 'quietEnd' | 'weeklyCap'>;
	people: Person[];
	events: KEvent[];
	threads: Thread[];
	prompts: Prompt[];
	/** The user's next free window in the next 3 days, or null. */
	freeSlot: Slot | null;
}

export interface Candidate {
	key: string; // stable id: 'p:<personId>', 's:<personId>', 't:<threadId>'
	kind: 'person' | 'thread' | 'suggest_circle';
	reason: ReasonKind;
	personId?: string;
	threadId?: string;
	title: string;
	reasonText: string;
	score: number;
}

export interface CardPick {
	candidate: Candidate;
	/** Set when re-showing a prompt already shown today. */
	promptId?: string;
}

const DAY = 86_400_000;
const ago = (now: Date, iso: string | undefined) => (iso ? (now.getTime() - new Date(iso).getTime()) / DAY : Infinity);
const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const stripDot = (s: string) => s.trim().replace(/[.\s]+$/, '');

export function personKey(id: string) {
	return `p:${id}`;
}

/** Which key a stored prompt belongs to. */
export function promptKey(p: Prompt): string {
	if (p.reason === 'suggest_circle' && p.personId) return `s:${p.personId}`;
	if (p.personId) return personKey(p.personId);
	return `t:${p.threadId}`;
}

function isToday(iso: string | undefined, now: Date) {
	return !!iso && localDay(iso) === localDay(now);
}

/** People and threads to leave alone right now, from earlier answers. */
function hidden(state: NudgeState) {
	const { now, prompts } = state;
	const people = new Set<string>();
	const threads = new Set<string>();
	for (const p of prompts) {
		if (!p.answer) continue;
		const recentNo = p.answer === 'not_now' && ago(now, p.answeredAt ?? p.shownAt) < NOT_NOW_DAYS;
		const answeredToday = isToday(p.answeredAt ?? p.shownAt, now);
		if (recentNo || answeredToday) {
			if (p.personId) people.add(p.personId);
			if (p.threadId) threads.add(p.threadId);
		}
	}
	return { people, threads };
}

export function eventReason(e: KEvent, today: string): string {
	return `${cap(stripDot(e.what))} ${dayPhrase(e.day!, today)}.`;
}

/** All candidates, one per person (their best reason), plus suggest-circle and thread cards. */
export function buildCandidates(state: NudgeState): Candidate[] {
	const { now, people, events, threads } = state;
	const today = localDay(now);
	const hide = hidden(state);
	const byPerson = new Map<string, Candidate>();
	const offer = (c: Candidate) => {
		const cur = byPerson.get(c.personId!);
		if (!cur || c.score > cur.score) byPerson.set(c.personId!, c);
	};
	const reachable = people.filter(
		(p) => p.circle !== 'out' && !hide.people.has(p.id) && ago(now, p.lastReachedAt) >= JUST_REACHED_DAYS
	);
	const reach = new Map(reachable.map((p) => [p.id, p]));

	// Something of theirs is coming up or just happened
	for (const e of events) {
		if (!e.day) continue;
		const d = dayDiff(today, e.day);
		if (d > EVENT_AHEAD_DAYS || d < -EVENT_BEHIND_DAYS) continue;
		for (const pid of e.personIds) {
			const p = reach.get(pid);
			if (!p) continue;
			offer({
				key: personKey(pid),
				kind: 'person',
				reason: 'event_soon',
				personId: pid,
				title: p.name,
				reasonText: eventReason(e, today),
				// the first person named is who the event is about; others are along for it
				score: (d >= 0 ? 10 - d : 8 + d) + (p.circle === 'in' ? 1 : 0) - (pid === e.personIds[0] ? 0 : 5)
			});
		}
	}

	// Something the user said they would do with someone
	for (const t of threads) {
		if (t.status !== 'open' || t.kind !== 'promise' || hide.threads.has(t.id)) continue;
		for (const pid of t.personIds) {
			const p = reach.get(pid);
			if (!p) continue;
			offer({
				key: personKey(pid),
				kind: 'person',
				reason: 'promise',
				personId: pid,
				threadId: t.id,
				title: p.name,
				reasonText: `On your mind: ${stripDot(t.title)}.`,
				score: 7 + (ago(now, t.updatedAt) < 3 ? 1 : 0) + (p.circle === 'in' ? 1 : 0)
			});
		}
	}

	// A quiet stretch with someone in the circle (never says how long)
	for (const p of reachable) {
		if (p.circle !== 'in') continue;
		const last = [p.lastReachedAt, p.lastMentionedAt].filter(Boolean).sort().pop() ?? p.createdAt;
		const gap = ago(now, last);
		if (gap < GAP_DAYS) continue;
		offer({
			key: personKey(p.id),
			kind: 'person',
			reason: 'gap',
			personId: p.id,
			title: p.name,
			reasonText: `It's been a while since you and ${p.name} talked.`,
			score: 4 + Math.min(2, gap / 30)
		});
	}

	const out: Candidate[] = [...byPerson.values()];

	// "Keep them in your circle?"
	for (const p of people) {
		if (p.circle !== 'suggested' || hide.people.has(p.id)) continue;
		out.push({
			key: `s:${p.id}`,
			kind: 'suggest_circle',
			reason: 'suggest_circle',
			personId: p.id,
			title: p.name,
			reasonText: `${p.why ? stripDot(p.why) + '. ' : ''}Keep ${p.name} in your circle?`,
			score: 3 + Math.min(2, p.mentions / 5)
		});
	}

	// The user's own threads
	const promised = new Set(out.map((c) => c.threadId).filter(Boolean));
	for (const t of threads) {
		if (t.status !== 'open' || hide.threads.has(t.id) || promised.has(t.id)) continue;
		if (t.kind === 'promise' && t.personIds.some((id) => reach.has(id))) continue;
		const due = t.dueDay ? dayDiff(today, t.dueDay) : null;
		out.push({
			key: `t:${t.id}`,
			kind: 'thread',
			reason: 'thread',
			threadId: t.id,
			title: t.title,
			reasonText: threadReason(t, today),
			score: (due !== null && due <= 3 ? 5 - Math.max(0, due) : 0) + Math.max(0, 2 - ago(now, t.updatedAt) / 7)
		});
	}
	return out;
}

function threadReason(t: Thread, today: string): string {
	if (t.dueDay && dayDiff(today, t.dueDay) >= -1 && dayDiff(today, t.dueDay) <= 7) return `Coming up ${dayPhrase(t.dueDay, today)}.`;
	switch (t.kind) {
		case 'idea':
			return 'An idea you had. Still interested?';
		case 'plan':
			return 'A plan you started.';
		case 'errand':
			return 'Still on your list.';
		default:
			return 'Something you meant to do.';
	}
}

/** Person nudges already used this week (re-showing a prompt does not count again). */
export function capUsed(state: NudgeState): number {
	return state.prompts.filter(
		(p) => p.personId && p.reason !== 'suggest_circle' && ago(state.now, p.shownAt) < 7
	).length;
}

/** True when there are more candidates than room, so a ranking pass could help. */
export function eligibleCount(state: NudgeState, cands: Candidate[]): number {
	return planToday(state, cands, undefined, Infinity).length;
}

/**
 * Picks today's cards. `order` (candidate keys, best first) comes from the rank task when used.
 * `limit` overrides the room size (used to count what is eligible).
 */
export function planToday(state: NudgeState, cands: Candidate[], order?: string[], limit?: number): CardPick[] {
	const n = limit ?? ROOM_CARDS[state.room];
	const { now } = state;
	const quiet = inQuietHours(now, state.settings.quietStart, state.settings.quietEnd);
	const todays = new Map<string, Prompt>();
	for (const p of state.prompts) if (!p.answer && isToday(p.shownAt, now)) todays.set(promptKey(p), p);

	const rank = (c: Candidate) => {
		const i = order ? order.indexOf(c.key) : -1;
		return i >= 0 ? i : Infinity;
	};
	const sort = (list: Candidate[]) =>
		[...list].sort(
			(a, b) =>
				Number(todays.has(b.key)) - Number(todays.has(a.key)) ||
				rank(a) - rank(b) ||
				b.score - a.score ||
				a.key.localeCompare(b.key)
		);

	const picks: CardPick[] = [];
	const used = new Set<string>();
	const take = (c: Candidate) => {
		picks.push({ candidate: c, promptId: todays.get(c.key)?.id });
		if (c.personId) used.add(c.personId);
	};

	if (!quiet) {
		// People: need a free window, and room under the weekly cap
		if (state.freeSlot) {
			let budget = Math.max(0, state.settings.weeklyCap - capUsed(state));
			for (const c of sort(cands.filter((c) => c.kind === 'person'))) {
				if (picks.length >= Math.min(n, MAX_PEOPLE_PER_DAY)) break;
				if (used.has(c.personId!)) continue;
				const reshow = todays.has(c.key);
				if (!reshow && budget <= 0) continue;
				if (!reshow) budget--;
				take(c);
			}
		}
		// At most one "keep in your circle?" a day
		const suggestShownToday = state.prompts.some((p) => p.reason === 'suggest_circle' && isToday(p.shownAt, now));
		for (const c of sort(cands.filter((c) => c.kind === 'suggest_circle'))) {
			if (picks.length >= n) break;
			if (used.has(c.personId!)) continue;
			if (suggestShownToday && !todays.has(c.key)) continue;
			take(c);
			break;
		}
	}
	for (const c of sort(cands.filter((c) => c.kind === 'thread'))) {
		if (picks.length >= n) break;
		take(c);
	}
	return picks;
}

/** The text on a person card: the reason plus the free window. */
export function withSlot(reasonText: string, slot: Slot | null, now: Date): string {
	return slot ? `${reasonText} You're free ${slotPhrase(new Date(slot.start), now)}.` : reasonText;
}

/** Window for "next 3 days" free-slot search. */
export function slotRange(now: Date): { from: string; to: string } {
	const today = localDay(now);
	return { from: today, to: addDays(today, EVENT_AHEAD_DAYS) };
}
