import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { Validator } from '@cfworker/json-schema';
import { SCHEMAS } from '../shared/src/schemas.ts';
import { resolveRelDay } from '../shared/src/dates.ts';
import type { ExtractOutput, WeaveOutput } from '../shared/src/api.ts';

interface SampleNote { daysAgo: number; time: string; source: string; text: string; extract: ExtractOutput }
interface SampleLife { myName: string; notes: SampleNote[]; weave: WeaveOutput; phones: Record<string, string> }

const TODAY = '2026-10-26';
const life = JSON.parse(readFileSync(new URL('./fixtures/sample-life.json', import.meta.url), 'utf8')) as SampleLife;
const validate = (schema: object, v: unknown) => new Validator(schema as never, '2020-12', false).validate(v);

function resolved(e: ExtractOutput): ExtractOutput {
	return { ...e, events: e.events.map((ev) => ({ ...ev, date: resolveRelDay(ev.date, TODAY) })) };
}

describe('sample-life.json', () => {
	it('has about 40 notes over 3 weeks, in time order', () => {
		expect(life.myName).toBe('Aarav');
		expect(life.notes.length).toBeGreaterThanOrEqual(36);
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
		life.notes.forEach((n, i) => {
			const names = new Set(n.extract.people.map((p) => p.name));
			expect(names.has(life.myName)).toBe(false);
			for (const ev of n.extract.events) for (const p of ev.people) expect(names.has(p), `note ${i} event ${p}`).toBe(true);
			for (const pr of n.extract.promises) if (pr.person) expect(names.has(pr.person), `note ${i} promise ${pr.person}`).toBe(true);
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

	it('suggests exactly the six circle people', () => {
		const suggested = life.weave.people.filter((p) => p.suggest_circle).map((p) => p.name).sort();
		expect(suggested).toEqual(['Kabir', 'Meera', 'Mum', 'Nani', 'Papa', 'Riya']);
		expect(life.weave.people.find((p) => p.name === 'Ishaan')?.suggest_circle).toBe(false);
	});

	it('gives Today reasons: events in the next week and an open promise to call Kabir', () => {
		const soon = life.notes.flatMap((n) => n.extract.events).filter((e) => {
			const m = e.date && /^rel:(-?\d+)$/.exec(e.date);
			return m && +m[1] >= 1 && +m[1] <= 7;
		});
		expect(soon.some((e) => e.people.includes('Mum'))).toBe(true);
		expect(soon.some((e) => e.people.includes('Papa'))).toBe(true);
		const call = life.weave.threads.find((t) => t.title === 'Call Kabir');
		expect(call?.status).toBe('open');
		expect(call?.kind).toBe('promise');
		const last = life.notes[Math.max(...call!.note_ids.map(Number))];
		expect(last.extract.promises.some((p) => p.person === 'Kabir')).toBe(true);
	});

	it('has phone numbers for the circle', () => {
		for (const name of ['Mum', 'Papa', 'Riya', 'Kabir', 'Meera', 'Nani']) expect(life.phones[name]).toMatch(/^91\d{10}$/);
	});
});
