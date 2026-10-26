import { Validator } from '@cfworker/json-schema';

const cache = new WeakMap<object, Validator>();

/** Validates against a JSON schema; returns a short error summary or null. */
export function schemaErrors(schema: object, value: unknown): string | null {
	let v = cache.get(schema);
	if (!v) {
		v = new Validator(schema as any, '2020-12', false);
		cache.set(schema, v);
	}
	const r = v.validate(value);
	if (r.valid) return null;
	return r.errors
		.slice(0, 6)
		.map((e) => `${e.instanceLocation}: ${e.error}`)
		.join('; ')
		.slice(0, 600);
}
