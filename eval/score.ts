// Scoring for the extract eval. Pure functions, unit-tested in score.test.ts.
import type { EventKind, ExtractOutput } from '../shared/src/api.ts';
import { guardDate, shiftDay } from '../shared/src/dates.ts';

export interface ExpectedEvent { kinds: EventKind[]; offset: number | number[] | null }
export interface Expected { people: string[]; events: ExpectedEvent[]; promises: number; sensitive: boolean }
export interface Case { id: string; text: string; expect: Expected }

/** An extracted event after the date guard. */
export interface GuardedEvent { kind: EventKind; day: string | null }

/** hits / total for one measure; total 0 means "not measured here". */
export interface Tally { hits: number; total: number }
export interface CaseScore {
	id: string;
	people: { recall: Tally; precision: Tally };
	eventDate: Tally;
	eventKind: Tally;
	promises: Tally;
	sensitive: Tally;
}

const key = (name: string) => name.trim().toLowerCase();

export function guardEvents(out: ExtractOutput, today: string): GuardedEvent[] {
	return out.events.map((e) => ({ kind: e.kind, day: guardDate(e.date, e.date_text, today).day }));
}

export function scorePeople(expected: string[], got: string[]): { recall: Tally; precision: Tally } {
	const want = new Set(expected.map(key));
	const have = new Set(got.map(key));
	const hits = [...have].filter((n) => want.has(n)).length;
	return { recall: { hits, total: want.size }, precision: { hits, total: have.size } };
}

const offsets = (e: ExpectedEvent): number[] => (e.offset === null ? [] : Array.isArray(e.offset) ? e.offset : [e.offset]);

/** Each expected event with a day must be matched by its own predicted event on one of the right days. */
export function scoreEventDates(expected: ExpectedEvent[], got: GuardedEvent[], today: string): Tally {
	const used = new Set<number>();
	let hits = 0;
	let total = 0;
	for (const e of expected) {
		const days = offsets(e).map((n) => shiftDay(today, n));
		if (!days.length) continue;
		total++;
		// Prefer a predicted event of a matching kind; fall back to any event on that day.
		const order = [...got.keys()].sort((a, b) => Number(!e.kinds.includes(got[a].kind)) - Number(!e.kinds.includes(got[b].kind)));
		const i = order.find((j) => !used.has(j) && got[j].day !== null && days.includes(got[j].day!));
		if (i !== undefined) {
			used.add(i);
			hits++;
		}
	}
	return { hits, total };
}

/** Each expected event must be matched by its own predicted event of an accepted kind. */
export function scoreEventKinds(expected: ExpectedEvent[], got: GuardedEvent[]): Tally {
	const used = new Set<number>();
	let hits = 0;
	for (const e of expected) {
		const i = got.findIndex((g, j) => !used.has(j) && e.kinds.includes(g.kind));
		if (i >= 0) {
			used.add(i);
			hits++;
		}
	}
	return { hits, total: expected.length };
}

/** Recall by count: finding more promises than expected is not rewarded or punished here. */
export function scorePromises(expected: number, got: number): Tally {
	return { hits: Math.min(expected, got), total: expected };
}

export function scoreCase(c: Case, out: ExtractOutput | null, today: string): CaseScore {
	const o: ExtractOutput = out ?? { language: 'other', sensitive: !c.expect.sensitive, people: [], events: [], promises: [], threads: [], gift_hints: [] };
	const events = guardEvents(o, today);
	return {
		id: c.id,
		people: scorePeople(c.expect.people, o.people.map((p) => p.name)),
		eventDate: scoreEventDates(c.expect.events, events, today),
		eventKind: scoreEventKinds(c.expect.events, events),
		promises: scorePromises(c.expect.promises, o.promises.length),
		sensitive: { hits: out && o.sensitive === c.expect.sensitive ? 1 : 0, total: 1 }
	};
}

export interface Summary {
	cases: number;
	failed: number;
	peopleRecall: number | null;
	peoplePrecision: number | null;
	eventDateAccuracy: number | null;
	eventKindAccuracy: number | null;
	promiseRecall: number | null;
	sensitiveAccuracy: number | null;
}

const ratio = (t: Tally): number | null => (t.total ? t.hits / t.total : null);
const sum = (ts: Tally[]): Tally => ts.reduce((a, t) => ({ hits: a.hits + t.hits, total: a.total + t.total }), { hits: 0, total: 0 });

/** Micro-averaged over all cases. */
export function summarise(scores: CaseScore[], failed = 0): Summary {
	return {
		cases: scores.length,
		failed,
		peopleRecall: ratio(sum(scores.map((s) => s.people.recall))),
		peoplePrecision: ratio(sum(scores.map((s) => s.people.precision))),
		eventDateAccuracy: ratio(sum(scores.map((s) => s.eventDate))),
		eventKindAccuracy: ratio(sum(scores.map((s) => s.eventKind))),
		promiseRecall: ratio(sum(scores.map((s) => s.promises))),
		sensitiveAccuracy: ratio(sum(scores.map((s) => s.sensitive)))
	};
}

const pct = (n: number | null) => (n === null ? '   -' : `${Math.round(n * 100)}%`.padStart(4));
const cell = (t: Tally) => (t.total ? `${t.hits}/${t.total}` : '-');

export function formatTable(scores: CaseScore[], summary: Summary): string {
	const head = ['case', 'ppl rec', 'ppl prec', 'dates', 'kinds', 'promises', 'sensitive'];
	const rows = scores.map((s) => [s.id, cell(s.people.recall), cell(s.people.precision), cell(s.eventDate), cell(s.eventKind), cell(s.promises), s.sensitive.hits ? 'ok' : 'miss']);
	const widths = head.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
	const line = (r: string[]) => r.map((c, i) => c.padEnd(widths[i])).join('  ');
	return [
		line(head),
		line(widths.map((w) => '-'.repeat(w))),
		...rows.map(line),
		'',
		`cases ${summary.cases}, failed calls ${summary.failed}`,
		`people recall ${pct(summary.peopleRecall)}   people precision ${pct(summary.peoplePrecision)}`,
		`event dates   ${pct(summary.eventDateAccuracy)}   event kinds      ${pct(summary.eventKindAccuracy)}`,
		`promises      ${pct(summary.promiseRecall)}   sensitive        ${pct(summary.sensitiveAccuracy)}`
	].join('\n');
}
