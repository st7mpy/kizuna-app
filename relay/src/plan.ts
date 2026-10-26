// The plan task: the model reads the user's words ("next weekend, not Sunday") and
// calls free_slots (run here, with the user's free hours and busy times) then finish.
// If the model fails at any point we still return two well-spread slots.
import {
	buildTask,
	freeSlots,
	isValidTimeZone,
	pickSpread,
	sampleSlots,
	slotAddDays,
	zonedDay,
	type PlanInput,
	type PlanOutput,
	type Slot,
	type Window
} from '@kizuna/shared';
import type { Env } from './env.ts';
import { addUsage, chat, type Message, type Usage } from './model.ts';

export const MAX_ROUNDS = 4;
const HORIZON_DAYS = 21;
const TOOL_SAMPLE = 12;

export class PlanInputError extends Error {}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const HHMM = /^\d{1,2}:\d{2}$/;

export function checkPlanInput(raw: any): PlanInput {
	const bad = (m: string) => {
		throw new PlanInputError(m);
	};
	if (typeof raw.request !== 'string' || raw.request.length > 500) bad('request');
	if (typeof raw.now !== 'string' || !Number.isFinite(Date.parse(raw.now))) bad('now');
	if (!isValidTimeZone(raw.timeZone)) bad('timeZone');
	if (!Array.isArray(raw.freeHours) || raw.freeHours.length > 100) bad('freeHours');
	const freeHours: Window[] = raw.freeHours.map((w: any) => {
		if (!w || !Number.isInteger(w.day) || w.day < 0 || w.day > 6 || !HHMM.test(w.start) || !HHMM.test(w.end)) bad('freeHours');
		return { day: w.day, start: w.start, end: w.end };
	});
	const busyIn = raw.busy ?? [];
	if (!Array.isArray(busyIn) || busyIn.length > 2000) bad('busy');
	const busy = busyIn
		.filter((b: any) => b && typeof b.start === 'string' && typeof b.end === 'string')
		.map((b: any) => ({ start: b.start, end: b.end }));
	const d = Number(raw.durationMinutes ?? 60);
	const durationMinutes = Number.isFinite(d) ? Math.min(480, Math.max(15, Math.round(d))) : 60;
	return { request: raw.request, now: raw.now, timeZone: raw.timeZone, freeHours, busy, durationMinutes };
}

interface FreeSlotsArgs { from?: string; to?: string; partOfDay?: string | null; excludeWeekdays?: number[] }

/** Slots for the next 7 days, two of them, spread out. */
export function fallbackSlots(input: PlanInput): Slot[] {
	const today = zonedDay(Date.parse(input.now), input.timeZone);
	return pickSpread(
		freeSlots({ ...input, from: today, to: slotAddDays(today, 6) }),
		2
	);
}

export async function runPlan(env: Env, raw: any): Promise<{ output: PlanOutput; usage: Usage }> {
	const input = checkPlanInput(raw);
	const today = zonedDay(Date.parse(input.now), input.timeZone);
	const lastDay = slotAddDays(today, HORIZON_DAYS);
	let usage: Usage = { input_tokens: 0, output_tokens: 0 };
	const known = new Map<string, Slot>();
	let nextId = 1;
	let finished: { slots: Slot[]; note: string | null } | null = null;

	const runFreeSlots = (args: FreeSlotsArgs) => {
		let from = typeof args.from === 'string' && DAY_RE.test(args.from) ? args.from : today;
		let to = typeof args.to === 'string' && DAY_RE.test(args.to) ? args.to : slotAddDays(today, 6);
		if (from < today) from = today;
		if (to > lastDay) to = lastDay;
		if (to < from) to = from;
		const part = ['morning', 'afternoon', 'evening'].includes(args.partOfDay as string)
			? (args.partOfDay as 'morning' | 'afternoon' | 'evening')
			: null;
		const exclude = Array.isArray(args.excludeWeekdays)
			? args.excludeWeekdays.filter((n) => Number.isInteger(n) && n >= 0 && n <= 6)
			: [];
		const all = freeSlots({ ...input, from, to, partOfDay: part, excludeWeekdays: exclude });
		const shown = sampleSlots(all, TOOL_SAMPLE).map((s) => {
			const id = `s${nextId++}`;
			known.set(id, s);
			return { id, start: s.start, end: s.end, label: s.label };
		});
		return { slots: shown, total: all.length };
	};

	const runFinish = (args: any) => {
		const picked: Slot[] = [];
		const ids: unknown[] = Array.isArray(args?.slot_ids) ? args.slot_ids : [];
		for (const id of ids) {
			const s = typeof id === 'string' ? known.get(id) : undefined;
			if (s && !picked.includes(s)) picked.push(s);
		}
		// Tolerate {slots:[{start,end}]}: only accept times we offered.
		if (Array.isArray(args?.slots)) {
			for (const x of args.slots) {
				const t = Date.parse(x?.start);
				const s = [...known.values()].find((k) => Date.parse(k.start) === t);
				if (s && !picked.includes(s)) picked.push(s);
			}
		}
		const note = typeof args?.note === 'string' && args.note.trim() ? args.note.trim().slice(0, 200) : null;
		finished = { slots: picked.slice(0, 2), note };
	};

	let built;
	try {
		built = buildTask('plan', input);
	} catch {
		built = null;
	}
	if (built) {
		const messages: Message[] = built.messages.map((m) => ({ ...m }));
		for (let round = 0; round < MAX_ROUNDS && !finished; round++) {
			const res = await chat(env, {
				messages,
				tools: built.tools,
				reasoning_effort: built.reasoning_effort,
				max_tokens: built.max_tokens
			});
			if (!res.ok) {
				console.error(`spark plan: ${res.detail}`);
				break;
			}
			usage = addUsage(usage, res.usage);
			const calls = res.message.tool_calls ?? [];
			if (calls.length === 0) break;
			messages.push({ role: 'assistant', content: res.message.content, tool_calls: calls });
			for (const call of calls) {
				let args: any = {};
				try {
					args = JSON.parse(call.function?.arguments || '{}');
				} catch {
					args = null;
				}
				let result: unknown;
				if (args === null) result = { error: 'arguments were not valid JSON' };
				else if (call.function?.name === 'free_slots') result = runFreeSlots(args);
				else if (call.function?.name === 'finish') {
					runFinish(args);
					result = { ok: true };
				} else result = { error: 'unknown tool' };
				messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) });
			}
		}
	}

	const done = finished as { slots: Slot[]; note: string | null } | null;
	if (done && done.slots.length > 0) {
		return { output: { slots: done.slots, note: done.note }, usage };
	}
	return { output: { slots: fallbackSlots(input), note: done?.note ?? null }, usage };
}
