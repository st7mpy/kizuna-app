// JSON schemas for Spark structured output (strict mode: every object has
// additionalProperties:false and lists every property as required; no recursion).
// Owner: AI pipeline. Must match the *Output types in api.ts.
import type { TaskName } from './api.ts';

export const RELATIONS = ['parent', 'sibling', 'partner', 'child', 'family', 'friend', 'colleague', 'other', 'unknown'] as const;
export const EVENT_KINDS = ['birthday', 'appointment', 'milestone', 'plan', 'trip', 'other'] as const;
export const THREAD_KINDS = ['idea', 'plan', 'promise', 'errand'] as const;
export const LANGUAGES = ['en', 'hi', 'mixed', 'other'] as const;

type Schema = Record<string, unknown>;

/** A strict object: every property required, nothing extra. */
function obj(properties: Record<string, Schema>): Schema {
	return { type: 'object', properties, required: Object.keys(properties), additionalProperties: false };
}
const str = (description?: string): Schema => (description ? { type: 'string', description } : { type: 'string' });
const nstr = (description?: string): Schema =>
	description ? { type: ['string', 'null'], description } : { type: ['string', 'null'] };
const strEnum = (values: readonly string[]): Schema => ({ type: 'string', enum: [...values] });
const arr = (items: Schema): Schema => ({ type: 'array', items });

const extract = obj({
	language: strEnum(LANGUAGES),
	sensitive: { type: 'boolean', description: 'true if health, money or conflict is mentioned' },
	people: arr(
		obj({
			name: str('display name; reuse a known name when it is the same person'),
			relation: strEnum(RELATIONS)
		})
	),
	events: arr(
		obj({
			what: str('short, e.g. "knee appointment"'),
			kind: strEnum(EVENT_KINDS),
			people: arr(str()),
			date: nstr('YYYY-MM-DD or null'),
			time: nstr('HH:MM 24h or null'),
			date_text: nstr('the exact date words used, or null')
		})
	),
	promises: arr(obj({ what: str(), person: nstr(), date_text: nstr() })),
	threads: arr(obj({ title: str(), kind: strEnum(THREAD_KINDS), people: arr(str()) })),
	gift_hints: arr(
		obj({
			person: str('name as in people'),
			what: str('the thing they would like, 2 to 8 words; never a price or money')
		})
	)
});

const weave = obj({
	people: arr(
		obj({
			id: nstr('existing person id, or null for someone new'),
			name: str(),
			aliases: arr(str()),
			merge_ids: arr(str()),
			relation: strEnum(RELATIONS),
			closeness: strEnum(['inner', 'close', 'around']),
			suggest_circle: { type: 'boolean' },
			why: str('one short sentence'),
			summary: str('what is going on with them now, at most 80 characters')
		})
	),
	threads: arr(
		obj({
			title: str(),
			kind: strEnum(THREAD_KINDS),
			people: arr(str()),
			note_ids: arr(str()),
			status: strEnum(['open', 'done'])
		})
	)
});

const draft = obj({
	line: str('one message, at most 200 characters'),
	language: strEnum(LANGUAGES)
});

const brief = obj({
	lines: { type: 'array', maxItems: 3, items: str('one short line, at most 90 characters') },
	ask: str('one warm open question, at most 90 characters, or empty')
});

const rank = obj({
	order: arr(str())
});

const windows = obj({
	windows: {
		type: 'array',
		maxItems: 3,
		items: obj({
			day: str('YYYY-MM-DD from the calendar'),
			start: str('HH:MM 24h local'),
			end: str('HH:MM 24h local, after start')
		})
	},
	not_this_weekend: { type: 'boolean', description: 'true if they said they cannot this weekend' },
	language: strEnum(LANGUAGES)
});

/** Structured-output tasks (plan and weekend use tools instead). */
export type SchemaTask = Exclude<TaskName, 'plan' | 'weekend'>;
export const SCHEMAS: Record<SchemaTask, object> = { extract, weave, draft, rank, windows, brief };
