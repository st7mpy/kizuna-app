import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { Validator } from '@cfworker/json-schema';
import { SCHEMAS } from '../shared/src/schemas.ts';
import { resolveRelDay } from '../shared/src/dates.ts';
import { isValidTimeZone } from '../shared/src/slots.ts';
import type { ExtractOutput, WeaveOutput } from '../shared/src/api.ts';

interface SampleNote { daysAgo: number; time: string; source: string; text: string; extract: ExtractOutput }
interface SampleMember { name: string; tz: string; status: string | null; via?: string; reply?: string; windows: { day: string; start: string; end: string }[] }
interface SampleLife {
	id: string; label: string; blurb: string; myName: string; notes: SampleNote[]; weave: WeaveOutput;
	circle: string[]; suggest: Record<string, string>; members: SampleMember[]; phones: Record<string, string>;
}

const TODAY = '2026-10-26';
const load = (key: string) => JSON.parse(readFileSync(new URL(`./fixtures/sample-${key}.json`, import.meta.url), 'utf8')) as SampleLife;
const validate = (schema: object, v: unknown) => new Validator(schema as never, '2020-12', false).validate(v);
const resolved = (e: ExtractOutput): ExtractOutput => ({ ...e, events: e.events.map((ev) => ({ ...ev, date: resolveRelDay(ev.date, TODAY) })) });

for (const key of ['abroad', 'usa']) {
	const life = load(key);
	describe(`sample-${key}.json`, () => {
		it('has about 30 notes over 3 weeks, in time order', () => {
			expect(life.id).toBe(key);
			expect(life.notes.length).toBeGreaterThanOrEqual(24);
			expect(life.notes.length).toBeLessThanOrEqual(44);
			for (let i = 1; i < life.notes.length; i++) {
				const [a, b] = [life.notes[i - 1], life.notes[i]];
				expect(a.daysAgo > b.daysAgo || (a.daysAgo === b.daysAgo && a.time < b.time), `note ${i} out of order`).toBe(true);
			}
			expect(Math.max(...life.notes.map((n) => n.daysAgo))).toBeLessThanOrEqual(21);
			for (const n of life.notes) {
				expect(n.time).toMatch(/^\d{2}:\d{2}$/);
				expect(['voice', 'typed']).toContain(n.source);
			}
		});

		it('every extract validates after rel:N is resolved', () => {
			life.notes.forEach((n, i) => {
				for (const ev of n.extract.events) if (ev.date !== null) expect(ev.date, `note ${i}`).toMatch(/^rel:-?\d+$/);
				const r = validate(SCHEMAS.extract, resolved(n.extract));
				expect(r.valid, `note ${i}: ${JSON.stringify(r.errors.slice(0, 2))}`).toBe(true);
			});
		});

		it('extract names are consistent within each note and never the user', () => {
			const known = new Set(life.weave.people.map((p) => p.name));
			life.notes.forEach((n, i) => {
				const names = new Set(n.extract.people.map((p) => p.name));
				expect(names.has(life.myName)).toBe(false);
				for (const p of names) expect(known.has(p), `note ${i} ${p} is not in the weave`).toBe(true);
				for (const ev of n.extract.events) for (const p of ev.people) expect(names.has(p), `note ${i} event ${p}`).toBe(true);
				for (const pr of n.extract.promises) if (pr.person) expect(names.has(pr.person), `note ${i} promise ${pr.person}`).toBe(true);
				for (const g of n.extract.gift_hints) expect(names.has(g.person), `note ${i} gift ${g.person}`).toBe(true);
			});
		});

		it('the weave validates and its note ids point at real notes', () => {
			const r = validate(SCHEMAS.weave, life.weave);
			expect(r.valid, JSON.stringify(r.errors.slice(0, 2))).toBe(true);
			for (const t of life.weave.threads) {
				expect(t.note_ids.length).toBeGreaterThan(0);
				for (const id of t.note_ids) {
					expect(id).toMatch(/^\d+$/);
					expect(+id).toBeLessThan(life.notes.length);
				}
			}
			for (const p of life.weave.people) {
				expect(p.id).toBeNull();
				expect(p.summary.length).toBeLessThanOrEqual(80);
			}
		});

		it('a circle of at most 8, each on the map with a zone, windows and a phone', () => {
			const suggested = life.weave.people.filter((p) => p.suggest_circle).map((p) => p.name).sort();
			expect(suggested).toEqual([...life.circle].sort());
			expect(life.circle.length).toBeLessThanOrEqual(8);
			expect(Object.keys(life.suggest).length).toBe(1);
			expect(life.members.map((m) => m.name).sort()).toEqual([...life.circle].sort());
			for (const m of life.members) {
				expect(isValidTimeZone(m.tz), m.tz).toBe(true);
				expect(m.windows.length).toBeGreaterThan(0);
				for (const w of m.windows) expect(w.start < w.end).toBe(true);
			}
			for (const name of life.circle) expect(life.phones[name]).toMatch(/^\d{10,13}$/);
		});

		it('an elder answered from the family page', () => {
			const page = life.members.filter((m) => m.via === 'page');
			expect(page.map((m) => m.reply)).toEqual(['Sunday afternoon works for me']);
		});

		it('one gift hint, and a birthday for that person in the next 10 days', () => {
			const hints = life.notes.flatMap((n) => n.extract.gift_hints);
			expect(hints).toHaveLength(1);
			const bday = life.notes.flatMap((n) => n.extract.events).find((e) => e.kind === 'birthday' && e.date && e.people[0] === hints[0].person)!;
			const d = Number(/^rel:(-?\d+)$/.exec(bday.date!)![1]);
			expect(d).toBeGreaterThanOrEqual(1);
			expect(d).toBeLessThanOrEqual(10);
		});

		it('plain English, with no language or region labels', () => {
			const text = JSON.stringify(life);
			expect(text).not.toMatch(/hindi|hinglish|india|diwali|delhi|mumbai|bengaluru|kolkata/i);
			for (const n of life.notes) expect(n.extract.language).toBe('en');
		});
	});
}

describe('the two families', () => {
	it('abroad: three people working and a student a day ahead', () => {
		const life = load('abroad');
		expect(life.members.find((m) => m.name === 'Leo')!.tz).toBe('Australia/Melbourne');
		expect(life.notes.some((n) => /exam/i.test(n.text))).toBe(true);
		expect(life.weave.threads.find((t) => t.title === 'Call Leo before exams')).toMatchObject({ kind: 'promise', status: 'open' });
	});
	it('usa: one family across at least five US zones', () => {
		const life = load('usa');
		const zones = new Set(life.members.map((m) => m.tz));
		expect(zones.size).toBeGreaterThanOrEqual(5);
		for (const z of zones) expect(z).toMatch(/^(America|Pacific\/Honolulu)/);
		expect(life.notes.some((n) => /Thanksgiving/.test(n.text))).toBe(true);
	});
});
