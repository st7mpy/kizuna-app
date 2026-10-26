import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { formatTable, guardEvents, scoreCase, scoreEventDates, scoreEventKinds, scorePeople, scorePromises, summarise } from './score.ts';
import type { Case } from './score.ts';
import type { ExtractOutput } from '../shared/src/api.ts';

const TODAY = '2026-10-26'; // Monday

const out = (o: Partial<ExtractOutput>): ExtractOutput => ({ language: 'mixed', sensitive: false, people: [], events: [], promises: [], threads: [], gift_hints: [], ...o });
const ev = (kind: ExtractOutput['events'][number]['kind'], date: string | null, date_text: string | null = null) => ({ what: 'x', kind, people: [], date, time: null, date_text });

describe('scorePeople', () => {
	it('is case-insensitive and counts both ways', () => {
		expect(scorePeople(['Mum', 'Kabir'], ['mum', 'Riya'])).toEqual({ recall: { hits: 1, total: 2 }, precision: { hits: 1, total: 2 } });
	});
	it('handles nobody expected', () => {
		expect(scorePeople([], [])).toEqual({ recall: { hits: 0, total: 0 }, precision: { hits: 0, total: 0 } });
	});
	it('ignores duplicates', () => expect(scorePeople(['Mum'], ['Mum', 'mum']).precision).toEqual({ hits: 1, total: 1 }));
});

describe('scoreEventDates', () => {
	it('matches a day and skips undated expectations', () => {
		const got = [{ kind: 'appointment' as const, day: '2026-10-29' }];
		expect(scoreEventDates([{ kinds: ['appointment'], offset: 3 }, { kinds: ['milestone'], offset: null }], got, TODAY)).toEqual({ hits: 1, total: 1 });
	});
	it('accepts any listed offset', () => {
		expect(scoreEventDates([{ kinds: ['plan'], offset: [5, 6] }], [{ kind: 'plan', day: '2026-11-01' }], TODAY)).toEqual({ hits: 1, total: 1 });
	});
	it('one predicted event cannot satisfy two expected ones', () => {
		const exp = [{ kinds: ['plan' as const], offset: 1 }, { kinds: ['trip' as const], offset: 1 }];
		expect(scoreEventDates(exp, [{ kind: 'plan', day: '2026-10-27' }], TODAY)).toEqual({ hits: 1, total: 2 });
	});
	it('misses a wrong day', () => {
		expect(scoreEventDates([{ kinds: ['plan'], offset: 1 }], [{ kind: 'plan', day: '2026-10-28' }], TODAY)).toEqual({ hits: 0, total: 1 });
	});
});

describe('scoreEventKinds', () => {
	it('matches kinds one to one', () => {
		const got = [{ kind: 'plan' as const, day: null }, { kind: 'birthday' as const, day: null }];
		expect(scoreEventKinds([{ kinds: ['birthday'], offset: null }, { kinds: ['plan', 'trip'], offset: null }, { kinds: ['plan'], offset: null }], got)).toEqual({ hits: 2, total: 3 });
	});
});

describe('scorePromises', () => {
	it('caps at expected', () => expect(scorePromises(1, 3)).toEqual({ hits: 1, total: 1 }));
	it('counts misses', () => expect(scorePromises(2, 1)).toEqual({ hits: 1, total: 2 }));
	it('nothing to find', () => expect(scorePromises(0, 2)).toEqual({ hits: 0, total: 0 }));
});

describe('scoreCase', () => {
	const c: Case = {
		id: 't1',
		text: 'Mum ka knee appointment Thursday hai, should call Kabir',
		expect: { people: ['Mum', 'Kabir'], events: [{ kinds: ['appointment'], offset: 3 }], promises: 1, sensitive: true }
	};
	it('applies the date guard before scoring', () => {
		// The model put Thursday on a Friday; the guard moves it back.
		const o = out({ sensitive: true, people: [{ name: 'Mum', relation: 'parent' }, { name: 'Kabir', relation: 'friend' }], events: [ev('appointment', '2026-10-30', 'Thursday')], promises: [{ what: 'call Kabir', person: 'Kabir', date_text: null }] });
		expect(guardEvents(o, TODAY)).toEqual([{ kind: 'appointment', day: '2026-10-29' }]);
		const s = scoreCase(c, o, TODAY);
		expect(s.eventDate).toEqual({ hits: 1, total: 1 });
		expect(s.people.recall).toEqual({ hits: 2, total: 2 });
		expect(s.promises).toEqual({ hits: 1, total: 1 });
		expect(s.sensitive).toEqual({ hits: 1, total: 1 });
	});
	it('a failed call scores zero everywhere', () => {
		const s = scoreCase(c, null, TODAY);
		expect([s.people.recall.hits, s.eventDate.hits, s.promises.hits, s.sensitive.hits]).toEqual([0, 0, 0, 0]);
	});
});

describe('summarise and formatTable', () => {
	it('micro-averages', () => {
		const c: Case = { id: 'a', text: '', expect: { people: ['A'], events: [], promises: 0, sensitive: false } };
		const s1 = scoreCase(c, out({ people: [{ name: 'A', relation: 'friend' }] }), TODAY);
		const s2 = scoreCase({ ...c, id: 'b' }, out({ sensitive: true }), TODAY);
		const sum = summarise([s1, s2], 0);
		expect(sum.peopleRecall).toBe(0.5);
		expect(sum.peoplePrecision).toBe(1);
		expect(sum.sensitiveAccuracy).toBe(0.5);
		expect(sum.eventDateAccuracy).toBeNull();
		expect(formatTable([s1, s2], sum)).toContain('people recall  50%');
	});
});

describe('hinglish-30 fixture', () => {
	const f = JSON.parse(readFileSync(new URL('./fixtures/hinglish-30.json', import.meta.url), 'utf8'));
	it('has 30 well-formed cases with unique ids', () => {
		expect(f.cases).toHaveLength(30);
		expect(new Set(f.cases.map((c: Case) => c.id)).size).toBe(30);
		for (const c of f.cases as Case[]) {
			expect(typeof c.text).toBe('string');
			expect(Array.isArray(c.expect.people)).toBe(true);
			expect(typeof c.expect.promises).toBe('number');
			expect(typeof c.expect.sensitive).toBe('boolean');
			for (const e of c.expect.events) expect(e.kinds.length).toBeGreaterThan(0);
		}
	});
	it('a perfect answer scores 100%', () => {
		const scores = (f.cases as Case[]).map((c) =>
			scoreCase(
				c,
				out({
					sensitive: c.expect.sensitive,
					people: c.expect.people.map((name) => ({ name, relation: 'unknown' as const })),
					events: c.expect.events.map((e) => {
						const off = e.offset === null ? null : Array.isArray(e.offset) ? e.offset[0] : e.offset;
						const d = off === null ? null : new Date(Date.UTC(2026, 9, 26 + off)).toISOString().slice(0, 10);
						return ev(e.kinds[0], d);
					}),
					promises: Array.from({ length: c.expect.promises }, () => ({ what: 'x', person: null, date_text: null }))
				}),
				f.today
			)
		);
		const s = summarise(scores);
		expect([s.peopleRecall, s.peoplePrecision, s.eventDateAccuracy, s.eventKindAccuracy, s.promiseRecall, s.sensitiveAccuracy]).toEqual([1, 1, 1, 1, 1, 1]);
	});
});
