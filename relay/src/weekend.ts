// The weekend task: the model calls get_windows / get_occasions / get_local_time / get_reasons
// (run here from WeekendInput only, so nothing is stored) and then finish with a slot id.
// The answer is checked in code; if the model fails we answer with bestWeekendSlot().
import {
	ME,
	WEEKEND_HORIZON_DAYS,
	WEEKEND_TOOL_NAMES,
	bestWeekendSlot,
	buildTask,
	checkWeekendSlot,
	isValidTimeZone,
	localTimeFor,
	slotAddDays,
	slotLabel,
	toSlot,
	weekendCandidates,
	zonedDay,
	zonedToUtc,
	type CircleWindow,
	type Occasion,
	type OccasionKind,
	type Slot,
	type WeekendInput,
	type WeekendOutput,
	type WeekendPerson,
	type WeekendToolSlot
} from '@kizuna/shared';
import { modelText } from '@kizuna/shared';
import type { Env } from './env.ts';
import { addUsage, chat, type Message, type Usage } from './model.ts';

export const MAX_ROUNDS = 5;
const TOOL_SLOTS = 16;
const DAY = 86_400_000;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const HHMM = /^\d{1,2}:\d{2}$/;
const ID_RE = /^[\w-]{1,64}$/;
const LANGS = ['en', 'hi', 'mixed', 'other'];
const KINDS: OccasionKind[] = ['festival', 'birthday', 'anniversary', 'other'];

export class WeekendInputError extends Error {}

function text(v: unknown, max: number): string {
	return typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max) : '';
}

function windowsOf(raw: unknown, max: number, bad: (m: string) => never): CircleWindow[] {
	if (raw == null) return [];
	if (!Array.isArray(raw) || raw.length > max) bad('windows');
	return (raw as any[]).map((w) => {
		const s = Date.parse(w?.start);
		const e = Date.parse(w?.end);
		if (typeof w?.start !== 'string' || typeof w?.end !== 'string' || w.start.length > 40 || w.end.length > 40) bad('windows');
		if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s || e - s > 2 * DAY) bad('windows');
		return { start: w.start, end: w.end };
	});
}

const quiet = (v: unknown, d: string) => (typeof v === 'string' && HHMM.test(v) ? v : d);

/** Validates and trims WeekendInput. Throws WeekendInputError on anything unusable. */
export function checkWeekendInput(raw: any): WeekendInput {
	const bad = (m: string): never => {
		throw new WeekendInputError(m);
	};
	if (typeof (raw.request ?? '') !== 'string' || (raw.request ?? '').length > 500) bad('request');
	if (typeof raw.now !== 'string' || !Number.isFinite(Date.parse(raw.now))) bad('now');
	if (!isValidTimeZone(raw.timeZone)) bad('timeZone');
	const me = raw.me;
	if (!me || typeof me !== 'object') bad('me');
	if (!Array.isArray(raw.people) || raw.people.length > 8) bad('people');
	const ids = new Set<string>();
	const people: WeekendPerson[] = raw.people.map((p: any) => {
		if (!p || typeof p.id !== 'string' || !ID_RE.test(p.id) || p.id === ME || ids.has(p.id)) bad('people.id');
		ids.add(p.id);
		if (!isValidTimeZone(p.timeZone)) bad('people.timeZone');
		return {
			id: p.id,
			name: text(p.name, 40) || 'Someone',
			relation: text(p.relation, 20) || 'unknown',
			timeZone: p.timeZone,
			language: LANGS.includes(p.language) ? p.language : 'en',
			windows: windowsOf(p.windows, 6, bad),
			quietStart: quiet(p.quietStart, '22:00'),
			quietEnd: quiet(p.quietEnd, '08:00')
		};
	});
	const occIn = raw.occasions ?? [];
	if (!Array.isArray(occIn) || occIn.length > 40) bad('occasions');
	const occasions: Occasion[] = occIn
		.filter((o: any) => o && typeof o.day === 'string' && DAY_RE.test(o.day) && text(o.name, 60))
		.map((o: any) => ({
			day: o.day,
			name: text(o.name, 60),
			kind: KINDS.includes(o.kind) ? o.kind : 'other',
			personIds: Array.isArray(o.personIds) ? o.personIds.filter((id: unknown) => typeof id === 'string' && ids.has(id)).slice(0, 8) : [],
			...(typeof o.region === 'string' ? { region: o.region.slice(0, 8) } : {})
		}));
	const reasonsIn = raw.reasons ?? [];
	if (!Array.isArray(reasonsIn) || reasonsIn.length > 40) bad('reasons');
	const perPerson = new Map<string, number>();
	const reasons = reasonsIn
		.filter((r: any) => r && typeof r.personId === 'string' && ids.has(r.personId) && text(r.text, 200))
		.filter((r: any) => {
			const n = perPerson.get(r.personId) ?? 0;
			perPerson.set(r.personId, n + 1);
			return n < 3;
		})
		.map((r: any) => ({ personId: r.personId, text: text(r.text, 200) }));
	const m = Number(raw.minMinutes ?? 45);
	return {
		request: text(raw.request ?? '', 500),
		now: raw.now,
		timeZone: raw.timeZone,
		me: { name: text(me.name, 40), windows: windowsOf(me.windows, 20, bad), quietStart: quiet(me.quietStart, '22:00'), quietEnd: quiet(me.quietEnd, '08:00') },
		people,
		occasions,
		reasons,
		minMinutes: Number.isFinite(m) ? Math.min(240, Math.max(15, Math.round(m))) : 45
	};
}

interface Run {
	input: WeekendInput;
	known: Map<string, { start: number; end: number; personIds: string[] }>;
	nextId: number;
	nowMs: number;
	today: string;
}

/** A day range in the user's zone, clamped to now .. now + 7 days. */
function rangeOf(run: Run, from: unknown, to: unknown): { from: number; to: number; fromDay: string; toDay: string } {
	const { input, today, nowMs } = run;
	const lastDay = slotAddDays(today, WEEKEND_HORIZON_DAYS);
	let f = typeof from === 'string' && DAY_RE.test(from) ? from : today;
	let t = typeof to === 'string' && DAY_RE.test(to) ? to : lastDay;
	if (f < today) f = today;
	if (t > lastDay) t = lastDay;
	if (t < f) t = f;
	const fromMs = Math.max(nowMs, zonedToUtc(f, 0, input.timeZone) ?? nowMs);
	const toMs = Math.min(nowMs + WEEKEND_HORIZON_DAYS * DAY, zonedToUtc(slotAddDays(t, 1), 0, input.timeZone) ?? nowMs + WEEKEND_HORIZON_DAYS * DAY);
	return { from: fromMs, to: Math.max(fromMs, toMs), fromDay: f, toDay: t };
}

function remember(run: Run, c: { start: number; end: number; personIds: string[] }): WeekendToolSlot {
	for (const [id, k] of run.known) {
		if (k.start === c.start && k.end === c.end && k.personIds.join() === c.personIds.join()) return { id, ...shown(run, k) };
	}
	const id = `w${run.nextId++}`;
	run.known.set(id, c);
	return { id, ...shown(run, c) };
}

function shown(run: Run, c: { start: number; end: number; personIds: string[] }) {
	const s = toSlot(c, run.input.timeZone);
	return { start: s.start, end: s.end, label: s.label, person_ids: c.personIds };
}

export function toolGetWindows(run: Run, args: any) {
	const { input } = run;
	const r = rangeOf(run, args?.from, args?.to);
	const askedIds: string[] = Array.isArray(args?.person_ids) ? args.person_ids.filter((x: unknown) => typeof x === 'string') : [];
	const chosen = askedIds.length ? input.people.filter((p) => askedIds.includes(p.id)) : input.people;
	const unknown = askedIds.filter((id) => id !== ME && !input.people.some((p) => p.id === id));
	const inRange = (w: CircleWindow) => Date.parse(w.end) > r.from && Date.parse(w.start) < r.to;
	const people = chosen.map((p) => ({
		person_id: p.id,
		name: p.name,
		time_zone: p.timeZone,
		quiet_hours: `${p.quietStart} to ${p.quietEnd}`,
		windows: p.windows.filter(inRange).map((w) => ({
			yours: slotLabel(Date.parse(w.start), Date.parse(w.end), input.timeZone),
			theirs: slotLabel(Date.parse(w.start), Date.parse(w.end), p.timeZone)
		}))
	}));
	const mine = input.me.windows.filter(inRange).map((w) => slotLabel(Date.parse(w.start), Date.parse(w.end), input.timeZone));
	const all = weekendCandidates(input, { from: r.from, to: r.to, personIds: chosen.map((p) => p.id) });
	const slots = all.slice(0, TOOL_SLOTS).map((c) => remember(run, c));
	return { from: r.fromDay, to: r.toDay, your_windows: mine, people, slots, total: all.length, ...(unknown.length ? { unknown_ids: unknown } : {}) };
}

export function toolGetOccasions(run: Run, args: any) {
	const today = run.today;
	const f = typeof args?.from === 'string' && DAY_RE.test(args.from) ? args.from : today;
	const t = typeof args?.to === 'string' && DAY_RE.test(args.to) ? args.to : slotAddDays(today, 14);
	const names = new Map(run.input.people.map((p) => [p.id, p.name]));
	return {
		occasions: run.input.occasions
			.filter((o) => o.day >= f && o.day <= t)
			.sort((a, b) => a.day.localeCompare(b.day))
			.map((o) => ({ day: o.day, name: o.name, kind: o.kind, people: o.personIds.map((id) => names.get(id) ?? id) }))
	};
}

export function toolGetLocalTime(run: Run, args: any) {
	const id = typeof args?.person_id === 'string' ? args.person_id : '';
	const slot = typeof args?.at === 'string' ? run.known.get(args.at) : undefined;
	const at = slot ? slot.start : Date.parse(args?.at);
	if (!Number.isFinite(at)) return { error: 'at must be an ISO time or a slot id' };
	const t = localTimeFor(run.input, id, at);
	if (!t) return { error: 'unknown person_id' };
	return { person_id: id, time_zone: t.timeZone, local: t.local, weekday: t.weekday, day: t.day, quiet_hours: t.quiet };
}

export function toolGetReasons(run: Run, args: any) {
	const id = typeof args?.person_id === 'string' ? args.person_id : '';
	if (!run.input.people.some((p) => p.id === id)) return { error: 'unknown person_id' };
	return { person_id: id, reasons: run.input.reasons.filter((r) => r.personId === id).map((r) => r.text) };
}

/** Turns finish arguments into a checked answer; null when it can't be used. */
export function checkFinish(run: Run, args: any): Omit<WeekendOutput, 'tools_used'> | null {
	const { input } = run;
	const ids = new Set(input.people.map((p) => p.id));
	const reason = modelText(args?.reason, 160) ?? '';
	const occasionName = modelText(args?.occasion, 60) ?? '';
	const occasion = input.occasions.find((o) => o.name.toLowerCase() === occasionName.toLowerCase())?.name ?? null;
	const skippedIn: any[] = Array.isArray(args?.skipped) ? args.skipped : [];
	const altFor = (personId: string, altId: unknown): Slot | null => {
		const k = typeof altId === 'string' ? run.known.get(altId) : undefined;
		if (!k) return null;
		const slot = toSlot(k, input.timeZone);
		const c = checkWeekendSlot(input, slot, [personId]);
		return c.meFree && c.personIds.length === 1 ? slot : null;
	};

	if (args?.slot_id == null) {
		// "Nothing fits" is a fine answer.
		const skipped = dedupe(skippedIn.filter((s) => ids.has(s?.person_id)).map((s) => ({ personId: s.person_id as string, why: text(s.why, 120) || 'Not free then.', alt: altFor(s.person_id, s.alt_slot_id) })));
		return { slot: null, personIds: [], skipped, reason: reason || 'Nothing lines up this weekend.', occasion };
	}
	const k = typeof args.slot_id === 'string' ? run.known.get(args.slot_id) : undefined;
	if (!k) return null;
	const slot = toSlot(k, input.timeZone);
	const asked: string[] = Array.isArray(args.person_ids) ? args.person_ids.filter((x: unknown) => typeof x === 'string' && ids.has(x as string)) : [];
	const check = checkWeekendSlot(input, slot, asked.length ? asked : k.personIds);
	if (!check.meFree || check.personIds.length === 0) return null;
	const dropped = (asked.length ? asked : k.personIds).filter((id) => !check.personIds.includes(id));
	const skipped = dedupe([
		...skippedIn
			.filter((s) => ids.has(s?.person_id) && !check.personIds.includes(s.person_id))
			.map((s) => ({ personId: s.person_id as string, why: text(s.why, 120) || 'Not free then.', alt: altFor(s.person_id, s.alt_slot_id) })),
		...dropped.map((id) => ({ personId: id, why: 'Not free then.', alt: null }))
	]);
	return { slot, personIds: check.personIds, skipped, reason: reason || "You're free together then.", occasion };
}

function dedupe<T extends { personId: string }>(list: T[]): T[] {
	const seen = new Set<string>();
	return list.filter((x) => (seen.has(x.personId) ? false : (seen.add(x.personId), true)));
}

export async function runWeekend(env: Env, raw: any): Promise<{ output: WeekendOutput; usage: Usage }> {
	const input = checkWeekendInput(raw);
	const nowMs = Date.parse(input.now);
	const run: Run = { input, known: new Map(), nextId: 1, nowMs, today: zonedDay(nowMs, input.timeZone) };
	let usage: Usage = { input_tokens: 0, output_tokens: 0 };
	const toolsUsed: string[] = [];
	let finished: Omit<WeekendOutput, 'tools_used'> | null = null;
	let badFinishes = 0;

	let built;
	try {
		built = buildTask('weekend', input);
	} catch {
		built = null;
	}
	if (built) {
		const messages: Message[] = built.messages.map((m) => ({ ...m }));
		for (let round = 0; round < MAX_ROUNDS && !finished && badFinishes < 2; round++) {
			const res = await chat(env, { messages, tools: built.tools, reasoning_effort: built.reasoning_effort, max_tokens: built.max_tokens });
			if (!res.ok) {
				console.error(`spark weekend: ${res.detail}`);
				break;
			}
			usage = addUsage(usage, res.usage);
			const calls = (res.message.tool_calls ?? []).slice(0, 12);
			if (calls.length === 0) break;
			messages.push({ role: 'assistant', content: res.message.content, tool_calls: calls });
			for (const call of calls) {
				const name = call.function?.name ?? '';
				let args: any;
				try {
					args = JSON.parse(call.function?.arguments || '{}');
				} catch {
					args = null;
				}
				if ((Object.values(WEEKEND_TOOL_NAMES) as string[]).includes(name)) toolsUsed.push(name);
				let result: unknown;
				if (args === null) result = { error: 'arguments were not valid JSON' };
				else if (name === WEEKEND_TOOL_NAMES.getWindows) result = toolGetWindows(run, args);
				else if (name === WEEKEND_TOOL_NAMES.getOccasions) result = toolGetOccasions(run, args);
				else if (name === WEEKEND_TOOL_NAMES.getLocalTime) result = toolGetLocalTime(run, args);
				else if (name === WEEKEND_TOOL_NAMES.getReasons) result = toolGetReasons(run, args);
				else if (name === WEEKEND_TOOL_NAMES.finish) {
					finished = checkFinish(run, args);
					if (!finished) badFinishes++;
					result = finished ? { ok: true } : { ok: false, error: 'slot_id must be a slot id from get_windows where the user and those people are all free; pick again or use null' };
				} else result = { error: 'unknown tool' };
				messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) });
			}
		}
	}
	if (finished) return { output: { ...(finished as Omit<WeekendOutput, 'tools_used'>), tools_used: toolsUsed }, usage };
	return { output: { ...bestWeekendSlot(input), tools_used: toolsUsed }, usage };
}
