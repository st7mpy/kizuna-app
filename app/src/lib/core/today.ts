// Today: turns the nudge plan into stored prompts and cards.
import type { Card, Prompt } from '@kizuna/shared';
import { db, newId, readSettings } from '../db.ts';
import { localDay } from './days.ts';
import { buildCandidates, eligibleCount, planToday, ROOM_CARDS, slotRange, withSlot, type Candidate, type NudgeState } from './nudges.ts';
import { isOnline, spark } from './relay.ts';
import { roomToday } from './settings.ts';
import { busyTimes, nextFreeWindow } from './time.ts';

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
		freeSlot: nextFreeWindow(s, now, from, to, busy)
	};
}

function actionsFor(c: Candidate): Card['actions'] {
	if (c.kind === 'person') return ['poke', 'time', 'not_now'];
	if (c.kind === 'suggest_circle') return ['keep', 'not_now'];
	return ['done', 'not_now'];
}

/** Cards for Today: 1, 3 or 5 by room level; empty is fine. */
export async function todayCards(): Promise<Card[]> {
	const now = new Date();
	const state = await loadNudgeState(now);
	const cands = buildCandidates(state);

	let order: string[] | undefined;
	if (isOnline() && eligibleCount(state, cands) > ROOM_CARDS[state.room]) {
		try {
			const eligible = planToday(state, cands, undefined, Infinity).map((p) => p.candidate);
			const r = await spark('rank', {
				room: state.room,
				candidates: eligible.map((c) => ({ id: c.key, title: c.title, reason: c.reasonText }))
			});
			order = r.order;
		} catch {
			/* deterministic order is fine */
		}
	}

	const picks = planToday(state, cands, order);
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

