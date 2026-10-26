import { describe, expect, it } from 'vitest';
import type { Slot } from '@kizuna/shared';
import { buildCandidates, capUsed, planToday, withSlot, type NudgeState } from './nudges.ts';
import { mkEvent, mkPerson, mkPrompt, mkThread } from './testing.ts';
import { isoWithOffset } from './days.ts';

// Monday 26 Oct 2026, 10:00 local
const NOW = new Date(2026, 9, 26, 10, 0);
const at = (d: number, h = 10, m = 0) => new Date(2026, 9, 26 + d, h, m);
const day = (d: number) => isoWithOffset(at(d)).slice(0, 10);
const THU_EVENING: Slot = { start: isoWithOffset(at(3, 18, 30)), end: isoWithOffset(at(3, 19, 30)), label: 'Thu 29 Oct, 18:30 to 19:30' };

function state(p: Partial<NudgeState> = {}): NudgeState {
	return {
		now: NOW,
		room: 'lots',
		settings: { quietStart: '21:30', quietEnd: '08:30', weeklyCap: 5 },
		people: [],
		events: [],
		threads: [],
		prompts: [],
		freeSlot: THU_EVENING,
		...p
	};
}
const plan = (s: NudgeState) => planToday(s, buildCandidates(s));
const titles = (s: NudgeState) => plan(s).map((p) => `${p.candidate.kind}:${p.candidate.title}`);

const kabir = mkPerson({ id: 'kabir', name: 'Kabir', circle: 'in', lastMentionedAt: at(-1).toISOString() });
const mum = mkPerson({ id: 'mum', name: 'Mum', relation: 'parent', circle: 'in', lastMentionedAt: at(-2).toISOString() });
const nani = mkPerson({ id: 'nani', name: 'Nani', relation: 'family', circle: 'in', lastMentionedAt: at(-20).toISOString() });
const meera = mkPerson({ id: 'meera', name: 'Meera', circle: 'suggested', why: 'You talk about her often', mentions: 4 });
const newJob = mkEvent({ what: 'started new job', personIds: ['kabir'], kind: 'milestone', day: day(-1) });
const knee = mkEvent({ what: 'knee appointment', personIds: ['mum'], kind: 'appointment', day: day(3) });
const trip = mkThread({ id: 'trip', title: 'Goa trip plan', kind: 'plan', updatedAt: at(-1).toISOString() });

describe('candidates', () => {
	it('returns nothing for an empty life', () => {
		expect(plan(state())).toEqual([]);
	});

	it('finds events coming up or just past, with day words and no counts', () => {
		const c = buildCandidates(state({ people: [kabir, mum], events: [newJob, knee] }));
		expect(c.find((x) => x.personId === 'kabir')?.reasonText).toBe('Started new job yesterday.');
		expect(c.find((x) => x.personId === 'mum')?.reasonText).toBe('Knee appointment on Thursday.');
		expect(c.every((x) => x.reason === 'event_soon')).toBe(true);
	});

	it('ignores events too far ahead or behind', () => {
		const far = mkEvent({ what: 'wedding', personIds: ['kabir'], day: day(4) });
		const old = mkEvent({ what: 'moved', personIds: ['kabir'], day: day(-3) });
		expect(buildCandidates(state({ people: [kabir], events: [far, old] }))).toEqual([]);
	});

	it('makes a promise card for an open promise with a person', () => {
		const t = mkThread({ title: 'Call Kabir', kind: 'promise', personIds: ['kabir'] });
		const c = buildCandidates(state({ people: [kabir], threads: [t] }));
		expect(c).toHaveLength(1);
		expect(c[0]).toMatchObject({ kind: 'person', reason: 'promise', threadId: t.id, reasonText: 'On your mind: Call Kabir.' });
	});

	it('makes a gap card only for circle people quiet for 14+ days, phrased without numbers', () => {
		const out = mkPerson({ name: 'Old friend', circle: 'none', lastMentionedAt: at(-40).toISOString() });
		const c = buildCandidates(state({ people: [nani, kabir, out] }));
		expect(c).toHaveLength(1);
		expect(c[0].reasonText).toBe("It's been a while since you and Nani talked.");
		expect(c[0].reasonText).not.toMatch(/\d/);
	});

	it('counts reaching out as recent contact for gaps', () => {
		const reached = { ...nani, lastReachedAt: at(-5).toISOString() };
		expect(buildCandidates(state({ people: [reached] }))).toEqual([]);
	});

	it('keeps one candidate per person, the strongest', () => {
		const t = mkThread({ title: 'Call Kabir', kind: 'promise', personIds: ['kabir'] });
		const c = buildCandidates(state({ people: [kabir], events: [newJob], threads: [t] }));
		expect(c.filter((x) => x.personId === 'kabir' && x.kind === 'person')).toHaveLength(1);
		expect(c[0].reason).toBe('event_soon');
	});

	it('skips people who are out of the circle or were just reached', () => {
		const out = { ...kabir, circle: 'out' as const };
		const justReached = { ...mum, lastReachedAt: at(-1).toISOString() };
		expect(buildCandidates(state({ people: [out, justReached], events: [newJob, knee] }))).toEqual([]);
	});
});

describe('planToday', () => {
	const life = () =>
		state({ people: [kabir, mum, nani, meera], events: [newJob, knee], threads: [trip, mkThread({ id: 'shoes', title: 'Return shoes', kind: 'errand' })] });

	it('gives 1, 3 or 5 cards by room, people first then threads', () => {
		expect(titles({ ...life(), room: 'low' })).toEqual(['person:Kabir']);
		expect(titles({ ...life(), room: 'some' })).toEqual(['person:Kabir', 'person:Mum', 'person:Nani']);
		const lots = titles({ ...life(), room: 'lots' });
		expect(lots).toEqual(['person:Kabir', 'person:Mum', 'person:Nani', 'suggest_circle:Meera', 'thread:Goa trip plan']);
	});

	it('still shows person cards in quiet hours, with the time moved out of them, and does not count them', () => {
		const late = { ...life(), now: at(0, 22, 15) };
		expect(titles(late).filter((t) => t.startsWith('person:'))).toEqual(['person:Kabir', 'person:Mum', 'person:Nani']);
		const early = { ...life(), now: at(0, 7, 0) };
		expect(titles(early).some((t) => t.startsWith('person:'))).toBe(true);
		// a free window inside quiet hours is no window at all
		const nightSlot: Slot = { start: isoWithOffset(at(0, 23)), end: isoWithOffset(at(1, 0)), label: '' };
		expect(titles({ ...late, freeSlot: nightSlot }).some((t) => t.startsWith('person:'))).toBe(false);
		// shown at night: not counted in the weekly cap
		const nightly = [1, 2, 3, 4, 5].map((d) => mkPrompt({ personId: 'x', reason: 'gap', shownAt: at(-d, 23).toISOString(), answer: 'poke' }));
		expect(capUsed({ ...life(), prompts: nightly })).toBe(0);
	});

	it('needs a free window for person cards', () => {
		expect(titles({ ...life(), freeSlot: null }).filter((t) => t.startsWith('person:'))).toEqual([]);
	});

	it('respects the weekly cap', () => {
		const shown = [1, 2, 3, 4].map((d) => mkPrompt({ personId: 'x', reason: 'gap', shownAt: at(-d).toISOString(), answer: 'poke' }));
		const s = { ...life(), prompts: shown };
		expect(capUsed(s)).toBe(4);
		expect(titles(s).filter((t) => t.startsWith('person:'))).toEqual(['person:Kabir']);
		// prompts older than 7 days stop counting
		const old = shown.map((p) => ({ ...p, shownAt: at(-8).toISOString() }));
		expect(titles({ ...life(), prompts: old }).filter((t) => t.startsWith('person:'))).toHaveLength(3);
	});

	it('does not count suggest-circle prompts in the cap', () => {
		const shown = [1, 2, 3, 4, 5].map((d) => mkPrompt({ personId: 'y', reason: 'suggest_circle', shownAt: at(-d).toISOString() }));
		expect(capUsed({ ...life(), prompts: shown })).toBe(0);
	});

	it('re-shows today\'s prompts without counting them twice', () => {
		const today = [
			mkPrompt({ id: 'a', personId: 'kabir', reason: 'event_soon', shownAt: at(0, 9).toISOString() }),
			mkPrompt({ id: 'b', personId: 'mum', reason: 'event_soon', shownAt: at(0, 9).toISOString() })
		];
		const older = [1, 2, 3].map((d) => mkPrompt({ personId: 'x', shownAt: at(-d).toISOString(), answer: 'poke' }));
		const s = { ...life(), room: 'some' as const, prompts: [...today, ...older] };
		// cap 5, used 5: the two from today come back, nothing new
		const picks = plan(s);
		expect(picks.filter((p) => p.candidate.kind === 'person').map((p) => p.promptId)).toEqual(['a', 'b']);
		expect(picks).toHaveLength(3);
		expect(picks[2].candidate.kind).toBe('suggest_circle');
	});

	it('keeps today\'s cards first so the list is stable', () => {
		const shownNani = mkPrompt({ id: 'n', personId: 'nani', reason: 'gap', shownAt: at(0, 9).toISOString() });
		expect(titles({ ...life(), room: 'low', prompts: [shownNani] })).toEqual(['person:Nani']);
	});

	it('hides a person for three days after not now', () => {
		const no = mkPrompt({ personId: 'kabir', reason: 'event_soon', shownAt: at(-2).toISOString(), answer: 'not_now', answeredAt: at(-2).toISOString() });
		expect(titles({ ...life(), prompts: [no] })).not.toContain('person:Kabir');
		const oldNo = { ...no, shownAt: at(-4).toISOString(), answeredAt: at(-4).toISOString() };
		const s = { ...life(), events: [knee, { ...newJob, day: day(1) }], prompts: [oldNo] };
		expect(titles(s)).toContain('person:Kabir');
	});

	it('does not show a person again the day their card was answered', () => {
		const poked = mkPrompt({ personId: 'kabir', reason: 'event_soon', shownAt: at(0, 9).toISOString(), answer: 'poke', answeredAt: at(0, 9, 5).toISOString() });
		expect(titles({ ...life(), prompts: [poked] })).not.toContain('person:Kabir');
	});

	it('never shows the same person twice', () => {
		const meeraEvent = mkEvent({ what: 'baby arrived', personIds: ['meera'], day: day(-1) });
		const t = titles({ ...life(), events: [newJob, knee, meeraEvent] });
		expect(t.filter((x) => x.endsWith(':Meera'))).toHaveLength(1);
		expect(t).toContain('person:Meera');
	});

	it('shows at most one suggest-circle card a day', () => {
		const riya = mkPerson({ id: 'riya', name: 'Riya', circle: 'suggested', mentions: 2 });
		const s = state({ people: [meera, riya] });
		expect(titles(s)).toEqual(['suggest_circle:Meera']);
		const shownToday = mkPrompt({ personId: 'meera', reason: 'suggest_circle', shownAt: at(0, 8, 45).toISOString(), answer: 'done', answeredAt: at(0, 9).toISOString() });
		expect(titles({ ...s, prompts: [shownToday] })).toEqual([]);
	});

	it('follows a rank order within each group, people still first', () => {
		const s = { ...life(), room: 'some' as const };
		const picks = planToday(s, buildCandidates(s), ['t:trip', 'p:nani', 'p:mum', 'p:kabir']);
		expect(picks.map((p) => p.candidate.title)).toEqual(['Nani', 'Mum', 'Kabir']);
	});

	it('hides threads after not now and drops done threads', () => {
		const no = mkPrompt({ threadId: 'trip', reason: 'thread', shownAt: at(-1).toISOString(), answer: 'not_now', answeredAt: at(-1).toISOString() });
		const s = state({ threads: [trip], prompts: [no] });
		expect(titles(s)).toEqual([]);
		expect(titles(state({ threads: [{ ...trip, status: 'done' }] }))).toEqual([]);
	});

	it('shows at most three people a day, even with lots of room', () => {
		const more = [1, 2, 3, 4].map((i) => mkPerson({ id: `x${i}`, name: `X${i}`, circle: 'in', lastMentionedAt: at(-30).toISOString() }));
		const t = titles({ ...life(), people: [kabir, mum, nani, ...more] });
		expect(t.filter((x) => x.startsWith('person:'))).toHaveLength(3);
		expect(t).toHaveLength(5);
	});

	it('an event is mostly about the first person named', () => {
		const papa = mkPerson({ id: 'papa', name: 'Papa', relation: 'parent', circle: 'in', lastMentionedAt: at(-1).toISOString() });
		const both = mkEvent({ what: 'knee appointment', personIds: ['mum', 'papa'], day: day(2) });
		const lunch = mkEvent({ what: 'cousin lunch', personIds: ['papa'], day: day(3) });
		const s = state({ room: 'low', people: [mum, papa], events: [both, lunch] });
		const c = buildCandidates(s);
		expect(c.find((x) => x.personId === 'papa')!.reasonText).toBe('Cousin lunch on Thursday.');
		expect(titles(s)).toEqual(['person:Mum']);
	});

	it('quiet hours that do not wrap midnight also work', () => {
		const s = { ...life(), settings: { quietStart: '09:00', quietEnd: '11:00', weeklyCap: 5 } };
		expect(titles(s).some((t) => t.startsWith('person:'))).toBe(true);
		const shown = [mkPrompt({ personId: 'x', reason: 'gap', shownAt: at(-1, 10).toISOString() }), mkPrompt({ personId: 'y', reason: 'gap', shownAt: at(-1, 12).toISOString() })];
		expect(capUsed({ ...s, prompts: shown })).toBe(1);
	});
});

describe('withSlot', () => {
	it('adds the free window in plain words', () => {
		expect(withSlot('Started new job yesterday.', THU_EVENING, NOW)).toBe("Started new job yesterday. You're free Thursday evening.");
		const tonight: Slot = { ...THU_EVENING, start: isoWithOffset(at(0, 19)) };
		expect(withSlot('X.', tonight, NOW)).toBe("X. You're free this evening.");
		expect(withSlot('X.', null, NOW)).toBe('X.');
	});
});
