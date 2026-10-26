import { describe, expect, it } from 'vitest';
import { Validator } from '@cfworker/json-schema';
import { SCHEMAS } from './schemas.ts';
import { PLAN_TOOLS, WEEKEND_TOOLS } from './tasks.ts';
import type { DraftOutput, ExtractOutput, RankOutput, WeaveOutput } from './api.ts';
import type { WindowsOutput } from './circle.ts';

type Node = Record<string, unknown>;

/** Walks a schema and returns every way it breaks the strict-mode rules. */
export function strictProblems(schema: Node, path = '$'): string[] {
	const out: string[] = [];
	if ('$ref' in schema || '$defs' in schema || 'definitions' in schema) out.push(`${path}: refs are not allowed`);
	for (const k of ['oneOf', 'allOf', 'not', 'if']) if (k in schema) out.push(`${path}: ${k} is not allowed`);
	const types = Array.isArray(schema.type) ? schema.type : [schema.type];
	if (!schema.type) out.push(`${path}: missing type`);
	if (types.includes('object')) {
		const props = (schema.properties ?? {}) as Record<string, Node>;
		if (schema.additionalProperties !== false) out.push(`${path}: additionalProperties must be false`);
		const req = (schema.required ?? []) as string[];
		const keys = Object.keys(props);
		if (req.length !== keys.length || keys.some((k) => !req.includes(k))) out.push(`${path}: every property must be required`);
		for (const k of keys) out.push(...strictProblems(props[k], `${path}.${k}`));
	}
	if (types.includes('array')) {
		if (!schema.items) out.push(`${path}: array needs items`);
		else out.push(...strictProblems(schema.items as Node, `${path}[]`));
	}
	if (schema.enum) {
		for (const v of schema.enum as unknown[]) {
			const t = v === null ? 'null' : typeof v === 'number' ? (Number.isInteger(v) ? 'integer' : 'number') : typeof v;
			if (!types.includes(t)) out.push(`${path}: enum value ${String(v)} not in type`);
		}
	}
	return out;
}

const validate = (schema: object, value: unknown) => new Validator(schema as never, '2020-12', false).validate(value);

const extractSample: ExtractOutput = {
	language: 'mixed',
	sensitive: true,
	people: [
		{ name: 'Mum', relation: 'parent' },
		{ name: 'Kabir', relation: 'friend' }
	],
	events: [
		{ what: 'knee appointment', kind: 'appointment', people: ['Mum'], date: '2026-10-29', time: '16:00', date_text: 'Thursday' },
		{ what: 'naya job join kiya', kind: 'milestone', people: ['Kabir'], date: null, time: null, date_text: null }
	],
	promises: [{ what: 'call Kabir', person: 'Kabir', date_text: null }],
	threads: [{ title: 'call Kabir', kind: 'promise', people: ['Kabir'] }],
	gift_hints: [{ person: 'Mum', what: 'a brighter reading lamp' }]
};
const weaveSample: WeaveOutput = {
	people: [
		{
			id: 'p1',
			name: 'Mum',
			aliases: ['ma', 'mummy'],
			merge_ids: ['p7'],
			relation: 'parent',
			closeness: 'inner',
			suggest_circle: true,
			why: 'You mention her most weeks.',
			summary: 'Has an appointment Thursday'
		},
		{ id: null, name: 'Kabir', aliases: [], merge_ids: [], relation: 'friend', closeness: 'close', suggest_circle: true, why: 'Old friend with news.', summary: '' }
	],
	threads: [{ title: 'Papa birthday plan', kind: 'plan', people: ['Riya', 'Papa'], note_ids: ['n1', 'n4'], status: 'open' }]
};
const draftSample: DraftOutput = { line: 'Kabir! Heard about the new job, how is the first week going?', language: 'en' };
const rankSample: RankOutput = { order: ['c2', 'c1'] };
const windowsSample: WindowsOutput = { windows: [{ day: '2026-11-01', start: '17:00', end: '20:00' }], not_this_weekend: false, language: 'mixed' };

describe('schemas are strict-mode valid', () => {
	for (const [name, schema] of Object.entries(SCHEMAS)) {
		it(name, () => expect(strictProblems(schema as Node)).toEqual([]));
	}
	for (const tool of PLAN_TOOLS as { function: { name: string; parameters: Node } }[]) {
		it(`plan tool ${tool.function.name}`, () => expect(strictProblems(tool.function.parameters)).toEqual([]));
	}
	for (const tool of WEEKEND_TOOLS as { function: { name: string; parameters: Node } }[]) {
		it(`weekend tool ${tool.function.name}`, () => expect(strictProblems(tool.function.parameters)).toEqual([]));
	}
	it('the walker catches a loose object', () => {
		expect(strictProblems({ type: 'object', properties: { a: { type: 'string' } } })).toHaveLength(2);
	});
});

describe('sample outputs validate', () => {
	it('extract', () => expect(validate(SCHEMAS.extract, extractSample).valid).toBe(true));
	it('weave', () => expect(validate(SCHEMAS.weave, weaveSample).valid).toBe(true));
	it('draft', () => expect(validate(SCHEMAS.draft, draftSample).valid).toBe(true));
	it('rank', () => expect(validate(SCHEMAS.rank, rankSample).valid).toBe(true));
	it('windows', () => expect(validate(SCHEMAS.windows, windowsSample).valid).toBe(true));
	it('windows may be empty', () => expect(validate(SCHEMAS.windows, { windows: [], not_this_weekend: true, language: 'en' }).valid).toBe(true));
	it('empty extract lists are fine', () => {
		expect(validate(SCHEMAS.extract, { ...extractSample, people: [], events: [], promises: [], threads: [], gift_hints: [] }).valid).toBe(true);
	});
});

describe('bad outputs are rejected', () => {
	it('unknown relation', () => {
		const bad = { ...extractSample, people: [{ name: 'X', relation: 'cousin' }] };
		expect(validate(SCHEMAS.extract, bad).valid).toBe(false);
	});
	it('extra property', () => expect(validate(SCHEMAS.draft, { ...draftSample, mood: 'happy' }).valid).toBe(false));
	it('missing property', () => {
		const { time: _t, ...ev } = extractSample.events[0];
		expect(validate(SCHEMAS.extract, { ...extractSample, events: [ev] }).valid).toBe(false);
	});
	it('wrong closeness', () => {
		const bad = { ...weaveSample, people: [{ ...weaveSample.people[0], closeness: 'far' }] };
		expect(validate(SCHEMAS.weave, bad).valid).toBe(false);
	});
	it('null where not allowed', () => expect(validate(SCHEMAS.rank, { order: null }).valid).toBe(false));
	it('extract without gift_hints', () => {
		const { gift_hints: _g, ...old } = extractSample;
		expect(validate(SCHEMAS.extract, old).valid).toBe(false);
	});
	it('more than three windows', () => {
		const w = windowsSample.windows[0];
		expect(validate(SCHEMAS.windows, { ...windowsSample, windows: [w, w, w, w] }).valid).toBe(false);
	});
});
