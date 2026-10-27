// The weekend card: from Friday 18:00, one plan for a call with the people who are free, or nothing.
// Shown only with a reason (an occasion within 10 days, or a note thread about someone), a shared
// window of 45+ minutes with at least one other person, outside everyone's quiet hours, under the weekly cap.
import type {
	CircleWindow,
	DraftInput,
	Language,
	Occasion,
	Person,
	Settings,
	Slot,
	WeekendCard,
	WeekendInput,
	WeekendOutput,
	WeekendPerson
} from '@kizuna/shared';
import { bestWeekendSlot, draftProblems, slotLabel as zonedSlotLabel, zonedDay, zonedIso } from '@kizuna/shared';
import { db, readSettings } from '../db.ts';
import { SAMPLE_CIRCLE_ID, freeWindows } from './circle.ts';
import { addDays, dayDiff, dayPhrase, dayToDate, deviceTimeZone, hourOf as hourAt, isoWithOffset, localDay, weekdayOf, WEEKDAYS } from './days.ts';
import { capUsed } from './nudges.ts';
import { occasionsBetween } from './occasions.ts';
import { buildDraftInput, buildMyLines, likelyLanguage, looksSensitive, templateLine, whatsappLink } from './poke.ts';
import { isOnline, spark } from './relay.ts';
import { updateSettings } from './settings.ts';
import { busyTimes } from './time.ts';
import { DEFAULT_QUIET_END, DEFAULT_QUIET_START, rangeTouchesQuiet, zonedClock, zonedMinutes } from './zones.ts';

export const WHATSAPP_SCHEDULE_TIP = 'In WhatsApp: Calls, then +, then Schedule call';
export const WEEKEND_MIN_MINUTES = 45;
export const WEEKEND_REASON_DAYS = 10;
const MAX_PEOPLE = 8;
const MIN = 60_000;

// ---------- when ----------

export interface WeekendRange {
	from: number; // ms
	to: number; // ms, end of Sunday
	saturday: string; // 'YYYY-MM-DD', names the weekend
	fromDay: string;
	toDay: string;
}

/** True when the demo override is on (?weekend=1, the setting, or sample life). */
export function weekendForced(s: Pick<Settings, 'forceWeekend' | 'circle'>): boolean {
	if (s.forceWeekend || s.circle?.id === SAMPLE_CIRCLE_ID) return true;
	try {
		return typeof location !== 'undefined' && new URLSearchParams(location.search).get('weekend') === '1';
	} catch {
		return false;
	}
}

/**
 * Pure: the weekend the card is about, in the phone's local time. From Friday 18:00 to the end of
 * Sunday; otherwise null, unless forced (then the coming weekend, or the next one late on Sunday).
 */
export function weekendRange(now: Date, force = false): WeekendRange | null {
	const today = localDay(now);
	const wd = weekdayOf(today);
	const hour = hourAt(now);
	const inWeekend = (wd === 5 && hour >= 18) || wd === 6 || wd === 0;
	let friday: string;
	if (inWeekend && !(force && wd === 0 && hour >= 14)) friday = addDays(today, wd === 5 ? 0 : wd === 6 ? -1 : -2);
	else if (force) friday = addDays(today, wd === 0 ? 5 : 5 - wd);
	else return null;
	const sunday = addDays(friday, 2);
	const fridayEvening = dayToDate(friday, '18:00').getTime();
	const end = dayToDate(addDays(sunday, 1)).getTime();
	return {
		from: Math.max(now.getTime(), fridayEvening),
		to: end,
		saturday: addDays(friday, 1),
		fromDay: inWeekend ? today : friday,
		toDay: sunday
	};
}

// ---------- the plan (pure) ----------

const covers = (ws: CircleWindow[], s: number, e: number) => ws.some((w) => Date.parse(w.start) <= s && Date.parse(w.end) >= e);

const city = (tz: string) => (tz.split('/').pop() ?? tz).replace(/_/g, ' ');

function partOfDay(ms: number, tz: string): 'morning' | 'afternoon' | 'evening' {
	const h = zonedMinutes(ms, tz) / 60;
	return h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening';
}

interface Choice {
	start: number;
	end: number;
	free: WeekendPerson[];
	score: number;
}

/** Every 30 minutes in my windows: who is free for a 60 (or 45) minute call, outside quiet hours. */
function choices(input: WeekendInput, people: WeekendPerson[]): Choice[] {
	const nowMs = Date.parse(input.now);
	const minMs = Math.max(15, input.minMinutes || WEEKEND_MIN_MINUTES) * MIN;
	const occasionDays = new Set(input.occasions.map((o) => o.day));
	const out: Choice[] = [];
	for (const w of input.me.windows) {
		const ws = Date.parse(w.start);
		const we = Date.parse(w.end);
		const first = Math.max(ws, Math.ceil((nowMs + 30 * MIN) / (30 * MIN)) * 30 * MIN);
		const starts = new Set<number>();
		for (let s = first; s + minMs <= we; s += 30 * MIN) starts.add(s);
		// also where someone's window opens, so an odd start like 12:15 is not missed
		for (const p of people) for (const x of p.windows) {
			const s = Date.parse(x.start);
			if (s >= first && s + minMs <= we) starts.add(s);
		}
		for (const s of [...starts].sort((a, b) => a - b)) {
			for (const len of [60 * MIN, minMs]) {
				const e = s + len;
				if (e > we) continue;
				if (rangeTouchesQuiet(s, e, input.timeZone, input.me.quietStart, input.me.quietEnd)) continue;
				const free = people.filter((p) => covers(p.windows, s, e) && !rangeTouchesQuiet(s, e, p.timeZone, p.quietStart, p.quietEnd));
				if (!free.length) continue;
				const onOccasion = occasionDays.has(zonedDay(s, input.timeZone)) ? 30 : 0;
				out.push({ start: s, end: e, free, score: free.length * 100 + onOccasion + (len === 60 * MIN ? 5 : 0) });
				break;
			}
		}
	}
	return out;
}

const best = (cs: Choice[]) => [...cs].sort((a, b) => b.score - a.score || a.start - b.start)[0] ?? null;

const toSlot = (c: { start: number; end: number }, tz: string): Slot => ({
	start: zonedIso(c.start, tz),
	end: zonedIso(c.end, tz),
	label: zonedSlotLabel(c.start, c.end, tz)
});

/** Festivals big enough to plan a family call around. */
export const MAJOR_FESTIVALS = new Set(['Thanksgiving', 'Christmas Eve', 'Christmas', "New Year's Eve", "New Year's Day", "Mother's Day", "Father's Day"]);

/** Pure: the reason line for a plan: the day itself, then someone's birthday, then a big festival, then a thread. */
export function weekendReason(input: WeekendInput, slotStart: number | null, personIds: string[] = []): { reason: string; occasion: string | null } {
	const today = zonedDay(Date.parse(input.now), input.timeZone);
	const soon = input.occasions.filter((o) => dayDiff(today, o.day) >= 0 && dayDiff(today, o.day) <= WEEKEND_REASON_DAYS);
	if (slotStart !== null) {
		const day = zonedDay(slotStart, input.timeZone);
		const on = soon.find((o) => o.day === day && (o.kind !== 'festival' || MAJOR_FESTIVALS.has(o.name)));
		if (on) return { reason: `It's ${on.name} ${partOfDay(slotStart, input.timeZone)}.`, occasion: on.name };
	}
	const theirs = soon.find((o) => o.personIds.some((id) => personIds.includes(id))) ?? soon.find((o) => o.kind !== 'festival');
	if (theirs) return { reason: `${theirs.name} is ${dayPhrase(theirs.day, today)}.`, occasion: theirs.name };
	const big = soon.find((o) => MAJOR_FESTIVALS.has(o.name));
	if (big) return { reason: `${big.name} is ${dayPhrase(big.day, today)}.`, occasion: big.name };
	const r = input.reasons.find((x) => personIds.includes(x.personId)) ?? input.reasons[0];
	if (r) return { reason: `On your mind: ${r.text.replace(/[.\s]+$/, '')}.`, occasion: null };
	return { reason: 'A good moment for a call.', occasion: null };
}

/** Pure: the reason rule (an occasion within 10 days, or a note thread about someone). */
export function hasReason(input: WeekendInput): boolean {
	const today = zonedDay(Date.parse(input.now), input.timeZone);
	return (
		input.occasions.some((o) => dayDiff(today, o.day) >= 0 && dayDiff(today, o.day) <= WEEKEND_REASON_DAYS) ||
		input.reasons.length > 0
	);
}

/** Pure: the best slot this weekend, done on the phone (offline, or when the planner fails). */
export function localWeekendPlan(input: WeekendInput): WeekendOutput {
	const pick = best(choices(input, input.people));
	if (!pick) return { slot: null, personIds: [], skipped: [], reason: '', occasion: null, tools_used: [] };
	const freeIds = new Set(pick.free.map((p) => p.id));
	const skipped = input.people
		.filter((p) => !freeIds.has(p.id))
		.map((p) => {
			const asleep = rangeTouchesQuiet(pick.start, pick.end, p.timeZone, p.quietStart, p.quietEnd);
			const why = asleep ? `asleep then (${zonedClock(pick.start, p.timeZone)} ${city(p.timeZone)})` : 'not free then';
			const alt = best(choices(input, [p]));
			return { personId: p.id, why, alt: alt ? toSlot(alt, input.timeZone) : null };
		});
	const { reason, occasion } = weekendReason(input, pick.start, [...freeIds]);
	return { slot: toSlot(pick, input.timeZone), personIds: [...freeIds], skipped, reason, occasion, tools_used: [] };
}

/** Pure: checks the planner's answer against the windows and quiet hours. Null when it can't be used. */
export function checkPlan(out: WeekendOutput, input: WeekendInput, range: Pick<WeekendRange, 'from' | 'to'>): WeekendOutput | null {
	if (!out || !out.slot) return null;
	const s = Date.parse(out.slot.start);
	const e = Date.parse(out.slot.end);
	if (!Number.isFinite(s) || !Number.isFinite(e) || e - s < (input.minMinutes || WEEKEND_MIN_MINUTES) * MIN) return null;
	if (s < range.from || e > range.to) return null;
	if (!covers(input.me.windows, s, e) || rangeTouchesQuiet(s, e, input.timeZone, input.me.quietStart, input.me.quietEnd)) return null;
	const byId = new Map(input.people.map((p) => [p.id, p]));
	const free = (out.personIds ?? []).filter((id) => {
		const p = byId.get(id);
		return !!p && covers(p.windows, s, e) && !rangeTouchesQuiet(s, e, p.timeZone, p.quietStart, p.quietEnd);
	});
	if (!free.length) return null;
	const skipped = (out.skipped ?? [])
		.filter((x) => byId.has(x.personId) && !free.includes(x.personId))
		.map((x) => ({ personId: x.personId, why: looksSensitive(x.why ?? '') ? 'not free then' : String(x.why ?? '').slice(0, 80), alt: x.alt ?? null }));
	const fallback = weekendReason(input, s, free);
	const reason = (out.reason ?? '').trim();
	const okReason = reason && reason.length <= 140 && !looksSensitive(reason) && !MONEY.test(reason);
	return {
		slot: { start: out.slot.start, end: out.slot.end, label: zonedSlotLabel(s, e, input.timeZone) },
		personIds: [...new Set(free)],
		skipped,
		reason: okReason ? reason : fallback.reason,
		occasion: out.occasion ?? fallback.occasion,
		tools_used: Array.isArray(out.tools_used) ? out.tools_used.slice(0, 20).map(String) : []
	};
}

// ---------- inputs from the db ----------

const stripDot = (s: string) => s.trim().replace(/[.\s]+$/, '');

/** Pure: up to 3 kind reason lines per person, from the user's own threads and events. Sensitive ones are left out. */
export function reasonsFor(
	people: Person[],
	threads: { title: string; personIds: string[]; status: string }[],
	events: { what: string; kind: string; personIds: string[]; day: string | null; fragmentId: string }[],
	sensitiveFragments: Set<string>,
	today: string
): { personId: string; text: string }[] {
	const out: { personId: string; text: string }[] = [];
	for (const p of people) {
		const lines: string[] = [];
		for (const t of threads) if (t.status === 'open' && t.personIds.includes(p.id) && !looksSensitive(t.title)) lines.push(stripDot(t.title));
		for (const e of events) {
			if (!e.personIds.includes(p.id) || !e.day || e.kind === 'appointment' || sensitiveFragments.has(e.fragmentId) || looksSensitive(e.what)) continue;
			const d = dayDiff(today, e.day);
			if (d < -7 || d > 14) continue;
			lines.push(`${stripDot(e.what)} ${dayPhrase(e.day, today)}`);
		}
		for (const text of [...new Set(lines)].slice(0, 3)) out.push({ personId: p.id, text });
	}
	return out;
}

/** Relaxed windows for sample life, so the demo works from any time zone: 07:00 to 23:00 each weekend day. */
function wholeDays(range: WeekendRange, tz: string, nowMs: number): CircleWindow[] {
	return freeWindows({
		freeHours: [5, 6, 0].map((day) => ({ day, start: '07:00', end: '23:00' })),
		busy: [],
		nowMs,
		timeZone: tz,
		fromDay: range.fromDay,
		toDay: range.toDay,
		notBefore: range.from,
		notAfter: range.to
	});
}

export interface WeekendContext {
	input: WeekendInput;
	range: WeekendRange;
	settings: Settings;
}

/** Gathers what the planner needs, or null when a rule says no card (day, answer, cap, nobody). */
export async function weekendContext(now: Date, request = ''): Promise<WeekendContext | null> {
	const s = await readSettings();
	const range = weekendRange(now, weekendForced(s));
	if (!range) return null;
	if (s.weekendAnswer?.weekend === range.saturday) return null;
	const prompts = await db.prompts.where('shownAt').aboveOrEqual(new Date(now.getTime() - 8 * 86_400_000).toISOString()).toArray();
	if (capUsed({ now, prompts, settings: s } as Parameters<typeof capUsed>[0]) >= s.weeklyCap) return null;

	const tz = deviceTimeZone();
	const nowMs = now.getTime();
	const [people, members, threads, events, stored, sensitive] = await Promise.all([
		db.people.where('circle').equals('in').toArray(),
		db.members.toArray(),
		db.threads.where('status').equals('open').toArray(),
		db.events.toArray(),
		db.occasions.toArray(),
		db.fragments.filter((f) => !!f.sensitive).primaryKeys()
	]);
	const planned: WeekendPerson[] = [];
	const plannedPeople: Person[] = [];
	for (const p of people) {
		const m = members.find((x) => x.personId === p.id);
		if (!m || m.entry.notThisWeekend) continue;
		const windows = m.entry.windows.filter((w) => Date.parse(w.end) > nowMs && Date.parse(w.start) < range.to);
		if (!windows.length) continue;
		const about = await db.fragments.where('personIds').equals(p.id).toArray();
		planned.push({
			id: p.id,
			name: p.name,
			relation: p.relation,
			timeZone: m.entry.tz,
			language: likelyLanguage(p, about),
			windows,
			quietStart: m.entry.quietStart ?? DEFAULT_QUIET_START,
			quietEnd: m.entry.quietEnd ?? DEFAULT_QUIET_END
		});
		plannedPeople.push(p);
		if (planned.length >= MAX_PEOPLE) break;
	}
	if (!planned.length) return null;

	const busy = await busyTimes(s);
	let myWindows = freeWindows({ freeHours: s.freeHours, busy, nowMs, timeZone: tz, fromDay: range.fromDay, toDay: range.toDay, notBefore: range.from, notAfter: range.to });
	const today = localDay(now);
	const input: WeekendInput = {
		request: request.trim().slice(0, 300),
		now: isoWithOffset(now),
		timeZone: tz,
		me: { name: (s.myName || 'Me').split(/\s+/)[0], windows: myWindows, quietStart: s.quietStart, quietEnd: s.quietEnd },
		people: planned,
		occasions: occasionsBetween(stored.map(({ id: _id, fragmentId: _f, ...o }) => o), today, 14),
		reasons: reasonsFor(plannedPeople, threads, events, new Set(sensitive as string[]), today),
		minMinutes: WEEKEND_MIN_MINUTES
	};
	// Sample life: the visitor's own free hours are unknown, so any waking hour this weekend counts.
	if (s.circle?.id === SAMPLE_CIRCLE_ID) {
		myWindows = wholeDays(range, tz, nowMs);
		input.me.windows = myWindows;
	}
	return { input, range, settings: s };
}

/** Plans with the Spark weekend task, checked in code; the phone's own plan when offline or unusable. */
async function plan(ctx: WeekendContext): Promise<WeekendCard | null> {
	const { input, range } = ctx;
	if (!hasReason(input)) return null;
	let local: WeekendOutput | null = null;
	try {
		local = checkPlan(bestWeekendSlot(input), input, range);
		if (local) local = { ...local, ...weekendReason(input, Date.parse(local.slot!.start), local.personIds) };
	} catch {
		/* use the phone's own plan below */
	}
	if (!local) local = localWeekendPlan(input); // also covers Friday evening
	if (!local.slot) return null; // nothing good this weekend: say nothing
	let out: WeekendOutput = local;
	if (isOnline()) {
		try {
			const checked = checkPlan(await spark('weekend', input), input, range);
			if (checked) out = checked;
		} catch {
			/* the phone's plan is fine */
		}
	}
	return {
		kind: 'weekend',
		slot: out.slot!,
		personIds: out.personIds,
		skipped: specificWhy(out.skipped, input, Date.parse(out.slot!.start)),
		reason: out.reason,
		occasion: out.occasion,
		trace: out.tools_used
	};
}

/** Pure: a plain "not free" becomes their local time when they live in another zone ("It's 00:30 in Toronto then."). */
export function specificWhy(skipped: WeekendOutput['skipped'], input: WeekendInput, at: number): WeekendOutput['skipped'] {
	const myClock = zonedClock(at, input.timeZone);
	return skipped.map((x) => {
		const p = input.people.find((q) => q.id === x.personId);
		const generic = !x.why || /^(not free then|asleep then)/i.test(x.why.trim());
		const clock = p ? zonedClock(at, p.timeZone) : null;
		if (!p || !generic || !clock || clock === myClock) return { ...x, why: generic ? 'Not free then.' : x.why };
		return { ...x, why: `It's ${clock} in ${city(p.timeZone)} then.` };
	});
}

// My windows start at "now" while inside one; round to the hour so the key doesn't change every minute.
const hourOf = (iso: string) => Math.floor(Date.parse(iso) / 3600_000);
const cacheKey = (ctx: WeekendContext) =>
	JSON.stringify([ctx.range.saturday, ctx.input.request, ctx.input.me.windows.map((w) => [hourOf(w.start), w.end]), ctx.input.people.map((p) => [p.id, p.windows]), ctx.input.occasions.map((o) => o.day + o.name), ctx.input.reasons]);

/** This weekend's card, or null. Planned once a day unless the windows or people change. */
export async function weekendCard(now = new Date()): Promise<WeekendCard | null> {
	const s = await readSettings();
	const today = localDay(now);
	const request = s.weekendCache?.day === today ? s.weekendCache.request : '';
	const ctx = await weekendContext(now, request);
	if (!ctx) return null;
	const key = cacheKey(ctx);
	if (s.weekendCache?.day === today && s.weekendCache.key === key) return s.weekendCache.card;
	const card = await plan(ctx);
	await updateSettings({ weekendCache: { day: today, key, request: ctx.input.request, card } });
	return card;
}

/** A plain-language change ("not Sunday, Dad has a game"). Returns the new card, or null if nothing fits. */
export async function planWeekend(request: string, now = new Date()): Promise<WeekendCard | null> {
	const ctx = await weekendContext(now, request);
	if (!ctx) return null;
	const card = await plan(ctx);
	await updateSettings({ weekendCache: { day: localDay(now), key: cacheKey(ctx), request: ctx.input.request, card } });
	return card;
}

/** "Not now" or "done": no more weekend card until next weekend. */
export async function answerWeekend(answer: 'not_now' | 'done', now = new Date()): Promise<void> {
	const s = await readSettings();
	// the weekend the card was about: this one if we're in it (or in a demo, the one it showed)
	const range = weekendRange(now, weekendForced(s)) ?? weekendRange(now, true);
	if (!range) return;
	await updateSettings({ weekendAnswer: { weekend: range.saturday, answer }, weekendCache: undefined });
}

// ---------- drafts ----------

/** Prices, money and shopping links never go in a draft. */
export const MONEY = /(₹|\$|£|€|\brs\.?\s?\d|\brupees?\b|\bprice\b|\bcost\w*\b|\bpaisa\b|\bpaise\b|\bbudget\b|\bdiscount\b|\bsale\b|\bexpensive\b|\bcheap\b|\bmehenga\b|\bsasta\b|https?:\/\/|www\.|\bamazon\b|\bflipkart\b)/i;

/** True when a drafted line is fine to show (no guilt, urgency, health or money). */
export function lineOk(line: string): boolean {
	return !!line.trim() && draftProblems(line).length === 0 && !looksSensitive(line) && !MONEY.test(line);
}

async function sparkLine(input: DraftInput): Promise<string | null> {
	if (!isOnline()) return null;
	try {
		const out = await spark('draft', input);
		const line = out.line?.trim().slice(0, 200);
		return line && lineOk(line) ? line : null;
	} catch {
		return null;
	}
}

/** 'Sunday', '11' style words for a slot in a zone. */
function slotWords(slot: Slot, tz: string): { day: string; time: string; part: string } {
	const ms = Date.parse(slot.start);
	const day = WEEKDAYS[new Date(`${zonedDay(ms, tz)}T12:00:00Z`).getUTCDay()];
	const clock = zonedClock(ms, tz) ?? '';
	return { day, time: clock.endsWith(':00') ? String(Number(clock.slice(0, 2))) : clock, part: partOfDay(ms, tz) };
}

/** Pure: the group line when the planner can't be reached. Plain English. */
export function groupTemplate(card: WeekendCard, _language: Language, tz: string): string {
	const w = slotWords(card.slot, tz);
	const lead = card.occasion ? `${card.occasion} video call?` : 'Family video call?';
	return `${lead} ${w.day} at ${w.time}${w.time.includes(':') ? '' : ':00'}, everyone's free then.`;
}

/** A line for the family group (wa.me without a number, so the user picks the group). */
export async function draftForGroup(card: WeekendCard): Promise<{ line: string; link: string }> {
	const tz = deviceTimeZone();
	const people = (await db.people.bulkGet(card.personIds)).filter((p): p is Person => !!p);
	const family = people.some((p) => ['parent', 'sibling', 'family', 'child', 'partner'].includes(p.relation));
	let language: Language = 'en';
	if (people[0]) {
		const about = await db.fragments.where('personIds').equals(people[0].id).toArray();
		language = likelyLanguage(people[0], about);
	}
	const mine = await db.fragments.orderBy('createdAt').reverse().limit(20).toArray();
	const fromSpark = await sparkLine({
			// addressed to everyone, so the line opens like a group message
			personName: 'everyone',
			relation: family ? 'family' : 'friend',
			reason: `A group video call at this time; everyone named is free. ${looksSensitive(card.reason) ? '' : card.reason}`.trim(),
			context: people.map((p) => `${p.name} is free then`).slice(0, 5),
			myRecentLines: buildMyLines(mine),
			language,
			withTime: card.slot.label
		});
	// a line written to one person (or naming "the group") doesn't fit a group chat
	const line = fromSpark && !/family group|how are you/i.test(fromSpark) ? fromSpark : groupTemplate(card, language, tz);
	return { line, link: whatsappLink(line) };
}

/** A line for someone not free in the main slot, offering their other time, in their own zone and language. */
export async function draftForPerson(card: WeekendCard, personId: string): Promise<{ line: string; link: string }> {
	const skip = card.skipped.find((x) => x.personId === personId);
	const slot = card.personIds.includes(personId) ? card.slot : (skip?.alt ?? undefined);
	const member = (await db.members.where('personId').equals(personId).toArray())[0];
	const tz = member?.entry.tz ?? deviceTimeZone();
	const label = slot ? zonedSlotLabel(Date.parse(slot.start), Date.parse(slot.end), tz) : undefined;
	const reason = card.occasion ? `Planning a family call for ${card.occasion}` : 'Planning a family call this weekend';
	const { input, person } = await buildDraftInput(personId, reason, slot);
	if (label) input.withTime = `${label} (their time)`;
	const line = (await sparkLine(input)) ?? personTemplate(person.name, input.language, label);
	return { line, link: whatsappLink(line, person.phone) };
}

/** Pure: the fallback line for one person. */
export function personTemplate(name: string, _language: Language, label?: string): string {
	const when = label ? label.replace(/ to \d\d:\d\d$/, '') : null;
	return when ? `Hi ${name}, we're doing a family call this weekend. Would ${when} work for you?` : `Hi ${name}, we're doing a family call this weekend. When works for you?`;
}

export { templateLine };
