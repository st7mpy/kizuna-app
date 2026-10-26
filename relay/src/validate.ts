import { CIRCLE_LIMITS, isValidTimeZone, zonedToUtc, type WindowsInput, type WindowsOutput } from '@kizuna/shared';
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

// ---------- windows task: input check and the code-side guard on the model's answer ----------

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const HHMM_RE = /^(\d{1,2}):(\d{2})$/;

/** A usable WindowsInput, or a short reason it isn't. */
export function checkWindowsInput(raw: any): WindowsInput | string {
	if (typeof raw?.reply !== 'string' || !raw.reply.trim()) return 'reply';
	if (raw.reply.length > 500) return 'reply too long';
	if (typeof raw.now !== 'string' || raw.now.length > 40 || !Number.isFinite(Date.parse(raw.now))) return 'now';
	if (!isValidTimeZone(raw.timeZone)) return 'timeZone';
	return { reply: raw.reply.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, ' ').trim(), now: raw.now, timeZone: raw.timeZone };
}

function minutes(s: string): number | null {
	const m = HHMM_RE.exec(s);
	if (!m) return null;
	const v = Number(m[1]) * 60 + Number(m[2]);
	return Number(m[2]) < 60 && v <= 24 * 60 ? v : null;
}

/**
 * Keeps only windows that are real: a valid day and times, end after start, ending after now
 * and starting within the next 7 days (in the replier's zone). Soonest first, at most 3.
 */
export function guardWindows(out: WindowsOutput, input: WindowsInput): WindowsOutput {
	const now = Date.parse(input.now);
	const horizon = now + 7 * 86_400_000;
	const kept: { day: string; start: string; end: string; at: number }[] = [];
	for (const w of out.windows ?? []) {
		if (!w || !DAY_RE.test(w.day)) continue;
		const a = minutes(w.start);
		const b = minutes(w.end);
		if (a == null || b == null || b <= a) continue;
		const s = zonedToUtc(w.day, a, input.timeZone);
		const e = zonedToUtc(w.day, b, input.timeZone);
		if (s == null || e == null || e <= now || s >= horizon) continue;
		const start = w.start.padStart(5, '0');
		const end = w.end.padStart(5, '0');
		if (kept.some((k) => k.day === w.day && k.start === start && k.end === end)) continue;
		kept.push({ day: w.day, start, end, at: s });
	}
	kept.sort((x, y) => x.at - y.at);
	return {
		windows: kept.slice(0, CIRCLE_LIMITS.maxWindows).map(({ day, start, end }) => ({ day, start, end })),
		not_this_weekend: out.not_this_weekend === true,
		language: out.language
	};
}
