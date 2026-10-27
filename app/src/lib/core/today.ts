// Today: turns the nudge plan into stored prompts and cards.
import type { Card, GiftCard, Prompt, WeekendCard } from '@kizuna/shared';
import { db, newId, readSettings } from '../db.ts';
import { deviceTimeZone, inQuietHours, localDay } from './days.ts';
import { giftCards } from './gifts.ts';
import { weekendCard } from './weekend.ts';
import { answeredTodayCount, buildCandidates, eligibleCount, planToday, ROOM_CARDS, slotRange, withSlot, type Candidate, type NudgeState } from './nudges.ts';
import { isOnline, spark } from './relay.ts';
import { roomToday } from './settings.ts';
import { busyTimes, findFreeSlots } from './time.ts';

const DAY = 86_400_000;

export async function loadNudgeState(now = new Date()): Promise<NudgeState> {
	const s = await readSettings();
	const since = new Date(now.getTime() - 14 * DAY).toISOString();
	const [people, events, threads, prompts] = await Promise.all([
		db.people.toArray(),
		db.events.toArray(),
		db.threads.where('status').equals('open').toArray(),
		db.prompts.where('shownAt').aboveOrEqual(since).toArray()
	]);
	const { from, to } = slotRange(now);
	const busy = s.icalUrl ? await busyTimes(s) : [];
	return {
		now,
		room: roomToday(s, now),
		settings: s,
		people,
		events,
		threads,
		prompts,
		// The next free window outside quiet hours (at night that is the next morning or later).
		freeSlot:
			findFreeSlots({ now, timeZone: deviceTimeZone(), freeHours: s.freeHours, busy, from, to, durationMinutes: 60 }).find(
				(x) => new Date(x.start).getTime() > now.getTime() && !inQuietHours(new Date(x.start), s.quietStart, s.quietEnd)
			) ?? null
	};
}

/** The weekend card (first) and gift cards, which come before person cards and count toward the room. */
export type TodayExtras = { weekend: WeekendCard | null; gifts: GiftCard[] };

export async function todayExtras(now = new Date()): Promise<TodayExtras> {
	const s = await readSettings();
	const n = ROOM_CARDS[roomToday(s, now)];
	const [weekend, gifts] = await Promise.all([weekendCard(now).catch(() => null), giftCards(now).catch(() => [] as GiftCard[])]);
	return { weekend, gifts: gifts.slice(0, Math.max(0, n - (weekend ? 1 : 0))) };
}

const EXTRAS_WAIT_MS = 600;
const rankCache = new Map<string, string[]>();
const rankAsked = new Set<string>();
/** For tests: forget earlier rankings. */
export function resetRankCache(): void {
	rankCache.clear();
	rankAsked.clear();
}
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
/** Stand-in while the weekend plan is still on its way: hold one place for it. */
const PENDING_EXTRAS = { weekend: {} as WeekendCard, gifts: [] } as TodayExtras;

function actionsFor(c: Candidate): Card['actions'] {
	if (c.kind === 'person') return ['poke', 'time', 'not_now'];
	if (c.kind === 'suggest_circle') return ['keep', 'not_now'];
	return ['done', 'not_now'];
}

/**
 * Cards for Today: 1, 3 or 5 by room level; empty is fine. Pass the extras when the page already asked
 * for them, so both run at once and the calendar is read only once.
 */
export async function todayCards(extrasP?: Promise<TodayExtras>, now = new Date()): Promise<Card[]> {
	// Person cards don't wait long for the weekend plan: if it is still thinking, keep one place for it.
	const extrasSoon = Promise.race([
		extrasP ?? todayExtras(now).catch((): TodayExtras => ({ weekend: null, gifts: [] })),
		wait(EXTRAS_WAIT_MS).then(() => PENDING_EXTRAS)
	]);
	const [state, extras] = await Promise.all([loadNudgeState(now), extrasSoon]);
	const cands = buildCandidates(state);
	// Room is for the whole day: cards already answered today count, so a reload doesn't bring a new batch.
	const room = Math.max(0, ROOM_CARDS[state.room] - (extras.weekend ? 1 : 0) - extras.gifts.length - answeredTodayCount(state));
	// someone with a gift card already has their moment on Today
	const giftPeople = new Set(extras.gifts.map((g) => g.personId));
	const shown = cands.filter((c) => !(c.kind === 'person' && c.personId && giftPeople.has(c.personId)));

	// Ranking never holds the cards: use the last ranking for this set of people if there is one,
	// and ask for a fresh one in the background for next time.
	let order: string[] | undefined;
	if (eligibleCount(state, shown) > room) {
		const eligible = planToday(state, shown, undefined, Infinity).map((p) => p.candidate);
		const key = eligible.map((c) => c.key).sort().join('|') + '#' + state.room;
		order = rankCache.get(key);
		if (!order && isOnline() && !rankAsked.has(key)) {
			rankAsked.add(key);
			spark('rank', {
				room: state.room,
				candidates: eligible.map((c) => ({ id: c.key, title: c.title, reason: c.reasonText }))
			})
				.then((r) => rankCache.set(key, r.order))
				.catch(() => {
					/* deterministic order is fine */
				});
		}
	}

	const picks = planToday(state, shown, order, room);
	const cards: Card[] = [];
	const fresh: Prompt[] = [];
	for (const { candidate: c, promptId } of picks) {
		const slot = c.kind === 'person' ? (state.freeSlot ?? undefined) : undefined;
		const reason = c.kind === 'person' ? withSlot(c.reasonText, state.freeSlot, now) : c.reasonText;
		let id = promptId;
		if (!id) {
			id = newId();
			fresh.push({
				id,
				personId: c.personId ?? null,
				threadId: c.threadId ?? null,
				reason: c.reason,
				reasonText: reason,
				shownAt: now.toISOString()
			});
		}
		cards.push({ promptId: id, kind: c.kind, personId: c.personId, threadId: c.threadId, title: c.title, reason, slot, actions: actionsFor(c) });
	}
	if (fresh.length) await db.prompts.bulkAdd(fresh);
	return cards;
}

/** True when the user has answered a card today (Today then says "That's all for now"). */
export async function answeredToday(now = new Date()): Promise<boolean> {
	const since = new Date(now.getTime() - 2 * DAY).toISOString();
	const prompts = await db.prompts.where('shownAt').aboveOrEqual(since).toArray();
	return answeredTodayCount({ prompts, now }) > 0;
}

export async function answerCard(promptId: string, answer: 'poke' | 'time' | 'not_now' | 'done' | 'keep'): Promise<void> {
	await db.transaction('rw', [db.prompts, db.people, db.threads], async () => {
		const p = await db.prompts.get(promptId);
		if (!p) return;
		const now = new Date().toISOString();
		// 'keep' is stored as 'done' (the prompt answer type has no 'keep')
		await db.prompts.update(promptId, { answer: answer === 'keep' ? 'done' : answer, answeredAt: now });
		if (p.reason === 'suggest_circle' && p.personId) {
			if (answer === 'keep') await db.people.update(p.personId, { circle: 'in' });
			if (answer === 'not_now') await db.people.update(p.personId, { circle: 'out' });
			return;
		}
		if (answer === 'done' && p.threadId) await db.threads.update(p.threadId, { status: 'done', updatedAt: now });
	});
}

