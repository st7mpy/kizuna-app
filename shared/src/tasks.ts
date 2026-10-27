// Builds the Meta API request body for each task. Used by the relay (and the eval).
// Owner: AI pipeline.
//
// How a request says which task it is (for the relay, logs and tools/fake-meta):
//   1. The first line of the system message is always `kizuna-task: <task>`.
//      `taskFromMessages(messages)` reads it back.
//   2. For json_schema tasks, `schema.name` equals the task name ('extract' | 'weave' | 'draft' | 'rank').
//   3. Only 'plan' and 'weekend' have `tools`; they never have a schema.
//
// Plan loop (run by the relay): the model calls `free_slots` (args FreeSlotsArgs); the relay fills
// now/timeZone/freeHours/busy/durationMinutes from PlanInput, runs freeSlots() and answers with a role
// 'tool' message whose content is JSON {slots:[{id,start,end,label}], total}. The model ends by
// calling `finish` (args FinishArgs) with up to two slot ids, best first.
//
// Weekend loop (run by the relay, stateless): tools get_windows / get_occasions / get_local_time /
// get_reasons answer from WeekendInput only; the model may call several in one turn. get_windows
// returns candidate slots with ids; `finish` (args WeekendFinishArgs) names one by id, or null.
import type { DraftInput, ExtractInput, PlanInput, RankInput, TaskIO, TaskName, WeaveInput } from './api.ts';
import type { WeekendInput, WindowsInput } from './circle.ts';
import { SCHEMAS } from './schemas.ts';
import { shiftDay, weekdayOfDay } from './dates.ts';
import { zonedDay } from './slots.ts';
import { comingWeekend } from './weekend.ts';

export interface ChatMessage { role: 'system' | 'user' | 'assistant' | 'tool'; content: string; tool_call_id?: string }

export interface BuiltTask {
	messages: ChatMessage[];
	/** json_schema response format; absent for tool-calling tasks */
	schema?: { name: string; schema: object };
	reasoning_effort: 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
	max_tokens: number;
	/** OpenAI-style tool definitions (plan only) */
	tools?: object[];
}

export const TASK_MARKER = 'kizuna-task:';
const TASK_NAMES: TaskName[] = ['extract', 'weave', 'draft', 'plan', 'rank', 'windows', 'weekend'];

/** Reads the task back from the marker on the first line of the system message. */
export function taskFromMessages(messages: { role: string; content?: unknown }[]): TaskName | null {
	const sys = messages.find((m) => m.role === 'system');
	if (!sys || typeof sys.content !== 'string') return null;
	const first = sys.content.split('\n', 1)[0].trim();
	if (!first.startsWith(TASK_MARKER)) return null;
	const name = first.slice(TASK_MARKER.length).trim() as TaskName;
	return TASK_NAMES.includes(name) ? name : null;
}

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** A small lookup so the model never has to do calendar maths: "Thu 2026-10-29 (+3)". */
export function calendarLines(today: string, back: number, ahead: number): string {
	const lines: string[] = [];
	for (let i = -back; i <= ahead; i++) {
		const day = shiftDay(today, i);
		const tag = i === 0 ? 'today' : i === 1 ? 'tomorrow' : i === -1 ? 'yesterday' : (i > 0 ? '+' : '') + i;
		lines.push(`${WEEKDAY_NAMES[weekdayOfDay(day)].slice(0, 3)} ${day} (${tag})`);
	}
	return lines.join('\n');
}

// ---------------------------------------------------------------- extract
export const EXTRACT_PROMPT = `You read one short note a person said or typed about their own life, and pull out the people, dated events, promises and open threads in it.

The note may be in any language, or mix two languages in one sentence. Read it as a fluent speaker of those languages would, and keep names and words as the user said them.

People
- Only real people the user knows. Never include the user themself ("I", "me").
- If someone matches a known person or one of their aliases, use the known name exactly. "Mom", "Mommy", "Ma", "Mum" are the same person as a known "Mom"; "Dad", "Daddy", "Pop" match a known "Dad"; "Grandma", "Gran" match "Grandma".
- New people: use the name as said, with a capital letter ("Jordan"). For family without a name use the role the user says ("Mom", "Dad", "Grandma", "Aunt Linda").
- relation: parent, sibling, partner, child, family (other relatives), friend, colleague, other, or unknown.
- Possessives, case endings and particles are not part of names: "Jordan's", "Mom's", "Lucas said" are Jordan, Mom, Lucas.

Events (things with a time, past or future): appointments, birthdays, anniversaries, milestones (new job, moving, baby, exam result), plans to meet, trips.
- date: the calendar day as YYYY-MM-DD, using the calendar given. Null if no day is said or implied.
- date_text: the exact date words from the note ("on Thursday", "tomorrow", "next week", "12 Nov"). Null if none.
- Date words: today, tomorrow, the day after tomorrow, next week (Monday to Sunday), this week, weekend = Saturday and Sunday. A bare weekday ("Thursday") is the coming one for future tense and the most recent one for past tense. In languages where one word means both tomorrow and yesterday, the tense decides.
- time: HH:MM 24h only if a clock time is said ("4 in the afternoon" = 16:00, "10 in the morning" = 10:00, "6 in the evening" = 18:00).
- people: names from your people list.

Promises: something the user means to do for or with someone: "should call Jordan", "need to send Maya a card", "check on Lucas after his exams". A plan the user merely mentions is an event, not a promise; an intention of theirs is a promise. person is the name from your people list, or null.

Threads: the user's own open loops, worth seeing again: an idea, a plan being made, a promise, an errand ("buy a gift for Dad", "book flights for Thanksgiving", "app idea for plants"). Short title in the note's language. Skip small talk.

Gift hints: things someone in the note wants, needs or would like to have. Look for "wants", "would love", "'d love", "would like", "needs a new", "has been eyeing", "keeps talking about getting", "wish list" and the same in other languages. Check every part of the note: a gift hint is often one clause among several.
- "Mom's birthday is next Friday, should call Leo before his exams, Dad wants new running shoes" -> gift hint {person: "Dad", what: "new running shoes"} (and Dad is in people).
- "Maya needs a new desk lamp" -> {person: "Maya", what: "new desk lamp"}. "Mom said she'd love a bread maker" -> {person: "Mom", what: "bread maker"}.
- Not gift hints: "Jordan wants to meet up" (a plan, not a thing), "Dad needs help with the move", "I want a new phone" (the user themself).
person is the name from your people list (anyone in a gift hint is also in people); what is the thing itself, 2 to 8 words. Never include prices, money, budgets, shops or links, and nothing about health (no medicines, no medical devices). Empty if none.

sensitive: true if the note mentions health (illness, surgery, appointments with a doctor, injuries, pregnancy complications, mental health), money (loans, debt, salary troubles) or conflict (fights, breakups, someone upset). Otherwise false.

language: the note's language as one of the codes en, hi, mixed (more than one language in the note), or other.

Keep "what" short (2 to 6 words) and in the note's language. Never invent people, dates or plans that are not in the note. Empty lists are fine.`;

function extractUser(i: ExtractInput): string {
	const known = i.knownPeople.length
		? i.knownPeople
				.map((p) => `- ${p.name} (${p.relation})${p.aliases.length ? `, also called: ${p.aliases.join(', ')}` : ''}`)
				.join('\n')
		: '(none yet)';
	return `Today is ${i.weekday}, ${i.today}.

Calendar:
${calendarLines(i.today, 7, 14)}

Known people:
${known}

Note:
"""
${i.text}
"""`;
}

// ---------------------------------------------------------------- weave
export const WEAVE_PROMPT = `You see every note a person has kept so far, oldest first, and the people already on file. Work out who matters to them right now and which of their own threads are still open.

People
- Return one entry for every distinct real person in the notes or on file (never the user themself).
- Merge nicknames and spellings of the same person: "Mom", "Mum", "Ma", "Mommy" are one person; "Benjamin" and "Ben" may be one. Keep the existing id (id field) of the record you keep, put every other existing id for that same person in merge_ids, and list all names they go by in aliases (lower case).
- id: the existing id when the person is on file, else null. Never invent ids.
- relation: parent, sibling, partner, child, family, friend, colleague, other, unknown.
- closeness: inner (family and the closest friends, mentioned warmly and often), close, or around (mentioned in passing).
- suggest_circle: true for at most 8 people the user would most want to stay close to: people they mention often or warmly, people with something happening in their life now, people they mean to reach out to. Passing mentions (a plumber, a colleague named once) are false.
- why: one short, kind sentence in plain English on why they are suggested (or why not), e.g. "You mention her most weeks, and her knee appointment is this Thursday."
- summary: what is going on with them now, at most 80 characters, e.g. "Started a new job at a design studio". Leave health, money and conflict out of summaries: write "Has an appointment Thursday", not the medical detail. Empty string if nothing is going on.

Threads
- The user's own open loops: ideas, plans, promises, errands. Merge notes about the same loop into one thread.
- note_ids: the ids of the notes the thread comes from, exactly as given.
- status: done if a later note says it happened or was settled, else open.
- people: names as in your people list.
- Titles are short, in the language the user used for them.

Never invent people, events or notes. Use only ids that appear in the input.`;

function weaveUser(i: WeaveInput): string {
	const people = i.people.length
		? i.people
				.map((p) => `- id=${p.id} name=${p.name} relation=${p.relation} circle=${p.circle}${p.aliases.length ? ` aliases=${p.aliases.join('|')}` : ''}`)
				.join('\n')
		: '(none yet)';
	const notes = i.notes.map((n) => `[${n.id}] ${n.day}: ${n.text.replace(/\s+/g, ' ').trim()}`).join('\n');
	return `Today is ${i.today}.

People on file:
${people}

Notes (id, day, text):
${notes}`;
}

// ---------------------------------------------------------------- draft
export const DRAFT_PROMPT = `You write one short message the user could send on WhatsApp to someone they care about. The user will read it, edit it if they like, and send it themselves.

Rules
- One line, at most 200 characters. Sound like the user: match the language, spelling, casing and warmth of their recent lines. If they mix languages, mix them the same way; if they write in lower case, so do you.
- Warm and easy to answer. Simple and specific to the reason, like a friend thinking of them.
- No guilt and no apologies for being out of touch. Never write "long time", "it's been ages", "sorry I've been busy", "you must be angry", or anything that counts time.
- No fake urgency: no "ASAP", "urgent", "need to talk", no deadlines.
- Never repeat health, money or conflict details. Ask kindly in general words instead: "How's your knee doing?" becomes "How are you doing?" or "How's Mom doing?".
- At most one emoji, and only if the user uses emoji. No hashtags, no quotation marks around the message.
- If a time is offered (withTime), suggest it lightly as a question, e.g. "Free for a coffee on Sat 9 Nov, 10:00?". Never insist.
- Do not sign the message or add a greeting line; just the message.
- language: the code for the language of your line (en, hi, mixed, other).`;

function draftUser(i: DraftInput): string {
	return `To: ${i.personName} (${i.relation})
Why now: ${i.reason}
What's going on with them:
${i.context.length ? i.context.map((c) => `- ${c}`).join('\n') : '- (nothing more)'}
How the user writes (their recent lines):
${i.myRecentLines.length ? i.myRecentLines.map((l) => `- ${l}`).join('\n') : '- (no examples; keep it plain and friendly)'}
Preferred language: ${i.language}
${i.withTime ? `Offer this time: ${i.withTime}` : 'No time to offer.'}`;
}

/** Plain checks the relay can run on a draft before showing it. Returns problems, empty if fine. */
export function draftProblems(line: string): string[] {
	const problems: string[] = [];
	if (!line.trim()) problems.push('empty');
	if (line.length > 200) problems.push('too_long');
	if (/\n/.test(line.trim())) problems.push('multi_line');
	if (/\b(long time|it'?s been (ages|forever|so long)|been ages|so long since|sorry (i|for) (have|haven'?t|being|been)|ages since|kitne din|bahut din)\b/i.test(line))
		problems.push('guilt');
	if (/\b(asap|urgent|urgently|right now|immediately|need to talk)\b/i.test(line)) problems.push('urgency');
	const emoji = line.match(/\p{Extended_Pictographic}/gu) ?? [];
	if (emoji.length > 1) problems.push('emoji');
	return problems;
}

// ---------------------------------------------------------------- rank
export const RANK_PROMPT = `You order a few suggestion cards for a person's day. They told you how much room they have today. Put first what matters most to them today.

Prefer, in order: something happening soon in a close person's life; a promise the user made to someone; a close person they have not reached in a while; the user's own open threads. With little room, lean towards light and easy ones. Return every candidate id exactly once, best first.`;

function rankUser(i: RankInput): string {
	return `Room today: ${i.room} (low = 1 card, some = 3, lots = 5)

Candidates:
${i.candidates.map((c) => `- id=${c.id} | ${c.title} | ${c.reason}`).join('\n')}`;
}

// ---------------------------------------------------------------- plan
export const PLAN_TOOL_NAMES = { freeSlots: 'free_slots', finish: 'finish' } as const;

/** Arguments the model passes to free_slots. The relay adds now/timeZone/freeHours/busy/durationMinutes. */
export interface FreeSlotsArgs {
	from: string; // 'YYYY-MM-DD'
	to: string; // 'YYYY-MM-DD'
	partOfDay: 'morning' | 'afternoon' | 'evening' | null;
	excludeWeekdays: number[]; // 0 = Sunday
}
/** What the relay returns as the tool message content for free_slots. */
export interface FreeSlotsResult {
	slots: { id: string; start: string; end: string; label: string }[];
	total: number;
}
/** Arguments of the final call. */
export interface FinishArgs {
	slot_ids: string[]; // up to 2, ids from free_slots results, best first
	note: string | null;
}

export const PLAN_TOOLS = [
	{
		type: 'function',
		function: {
			name: PLAN_TOOL_NAMES.freeSlots,
			description:
				"Lists free times in the user's calendar between two days (inclusive), inside their usual free hours and outside busy times. Call it again with other days if nothing fits.",
			strict: true,
			parameters: {
				type: 'object',
				properties: {
					from: { type: 'string', description: 'first day, YYYY-MM-DD' },
					to: { type: 'string', description: 'last day, YYYY-MM-DD' },
					partOfDay: { type: ['string', 'null'], enum: ['morning', 'afternoon', 'evening', null], description: 'only this part of the day, or null for any' },
					excludeWeekdays: { type: 'array', items: { type: 'integer', minimum: 0, maximum: 6 }, description: 'weekdays to skip, 0 = Sunday ... 6 = Saturday' }
				},
				required: ['from', 'to', 'partOfDay', 'excludeWeekdays'],
				additionalProperties: false
			}
		}
	},
	{
		type: 'function',
		function: {
			name: PLAN_TOOL_NAMES.finish,
			description: 'Gives the final answer: up to two slot ids from free_slots results, best first, and an optional short note.',
			strict: true,
			parameters: {
				type: 'object',
				properties: {
					slot_ids: { type: 'array', items: { type: 'string' }, maxItems: 2, description: 'ids from free_slots results, best first' },
					note: { type: ['string', 'null'], description: 'one short plain sentence when the request could not be fully met, else null' }
				},
				required: ['slot_ids', 'note'],
				additionalProperties: false
			}
		}
	}
];

export const PLAN_PROMPT = `You find two good times for the user to meet someone, from a request in plain words, in any language, like "next weekend, not Sunday", "some evening next week", or nothing at all.

How to work
1. Turn the request into days using the calendar given: from, to, partOfDay (morning before 12:00, afternoon 12:00 to 17:00, evening after 17:00) and weekdays to skip. "weekend" = Saturday and Sunday; "not Sunday" = skip 0; "next week" = Monday to Sunday. With no request, look at the next 7 days.
2. Call free_slots. If it finds nothing, widen once (the following week, or any part of day) and call it again.
3. Call finish with the two best slot ids, best first: prefer what the request asked for, then sooner, then two different days. If you had to stray from the request, add a short note in plain words, e.g. "Nothing free on Saturday, so Friday evening instead." Else note is null.
Always end by calling finish, even with no slots. Never make up slot ids.`;

function planUser(i: PlanInput): string {
	const today = i.now.slice(0, 10);
	return `Now: ${i.now} (${i.timeZone})
Meeting length: ${i.durationMinutes} minutes
Request: ${i.request.trim() ? `"${i.request.trim()}"` : '(none: just find two good times soon)'}

Calendar:
${calendarLines(today, 0, 21)}`;
}

// ---------------------------------------------------------------- windows
export const WINDOWS_PROMPT = `You read a short reply from a family member or friend saying when they are free for a call, and turn it into at most three time windows in their own local time.

The reply may be in any language, or mix two languages: "Sunday afternoon works for me", "Sat after lunch, not before 2", "tomorrow morning I have a little time", "can't do this weekend". Read it as a fluent speaker would.

Windows
- day: YYYY-MM-DD, using the calendar given. Only days in the calendar. weekend = the coming Saturday and Sunday. today, tomorrow, the day after tomorrow as usual.
- start and end: HH:MM, 24 hour, local time, on that same day (end after start).
- Parts of the day: morning = 09:00 to 12:00; afternoon / after lunch = 13:00 to 16:00; evening = 17:00 to 20:00; night = 20:00 to 22:00. A whole day without a part ("free Sunday") = 10:00 to 20:00.
- Clock words: "2" in the afternoon = 14:00; "after 2" or "not before 2" starts at 14:00; "before 6" ends at 18:00. Afternoon and evening hours below 8 are pm. A single clock time alone = one hour from it.
- At most 3 windows, soonest first. If they give more, keep the three clearest.

not_this_weekend: true when they say they can't this weekend ("not this weekend", "busy all weekend"). Then windows is empty unless they also name another time.

language: the reply's language as one of the codes en, hi, mixed (more than one language), or other.

If the reply gives no time at all, windows is empty. Never invent times that are not in the reply.`;

function windowsUser(i: WindowsInput): string {
	const today = zonedDay(Date.parse(i.now), i.timeZone);
	return `Now: ${i.now} (${i.timeZone})

Calendar:
${calendarLines(today, 0, 8)}

Reply:
"""
${i.reply}
"""`;
}

// ---------------------------------------------------------------- weekend
export const WEEKEND_TOOL_NAMES = {
	getWindows: 'get_windows',
	getOccasions: 'get_occasions',
	getLocalTime: 'get_local_time',
	getReasons: 'get_reasons',
	finish: 'finish'
} as const;

/** Arguments of the weekend `finish` call: WeekendOutput minus tools_used, with slots named by id. */
export interface WeekendFinishArgs {
	slot_id: string | null; // an id from get_windows, or null when nothing fits
	person_ids: string[]; // people free in that slot (not the user)
	skipped: { person_id: string; why: string; alt_slot_id: string | null }[];
	reason: string;
	occasion: string | null;
}
/** One candidate slot as get_windows returns it. */
export interface WeekendToolSlot {
	id: string;
	start: string;
	end: string;
	label: string; // in the user's zone
	person_ids: string[]; // others free then
}

const DAY_PARAM = { type: 'string', description: 'day in the user\'s time zone, YYYY-MM-DD' };

export const WEEKEND_TOOLS = [
	{
		type: 'function',
		function: {
			name: WEEKEND_TOOL_NAMES.getWindows,
			description:
				"Each person's shared free windows between two days (inclusive), and candidate call slots where the user and at least one other person are free together, outside everyone's quiet hours. Biggest groups first. Each slot has an id for finish.",
			strict: true,
			parameters: {
				type: 'object',
				properties: {
					person_ids: { type: 'array', items: { type: 'string' }, description: 'people to include; empty for everyone' },
					from: DAY_PARAM,
					to: DAY_PARAM
				},
				required: ['person_ids', 'from', 'to'],
				additionalProperties: false
			}
		}
	},
	{
		type: 'function',
		function: {
			name: WEEKEND_TOOL_NAMES.getOccasions,
			description: 'Festivals, birthdays and anniversaries between two days (inclusive).',
			strict: true,
			parameters: {
				type: 'object',
				properties: { from: DAY_PARAM, to: DAY_PARAM },
				required: ['from', 'to'],
				additionalProperties: false
			}
		}
	},
	{
		type: 'function',
		function: {
			name: WEEKEND_TOOL_NAMES.getLocalTime,
			description: "The local time and weekday for a person at an instant, in their own time zone, and whether it is inside their quiet hours. person_id 'me' is the user.",
			strict: true,
			parameters: {
				type: 'object',
				properties: {
					person_id: { type: 'string' },
					at: { type: 'string', description: 'an ISO time with offset, or a slot id from get_windows' }
				},
				required: ['person_id', 'at'],
				additionalProperties: false
			}
		}
	},
	{
		type: 'function',
		function: {
			name: WEEKEND_TOOL_NAMES.getReasons,
			description: "Short lines from the user's own notes about a person (sensitive details already removed).",
			strict: true,
			parameters: {
				type: 'object',
				properties: { person_id: { type: 'string' } },
				required: ['person_id'],
				additionalProperties: false
			}
		}
	},
	{
		type: 'function',
		function: {
			name: WEEKEND_TOOL_NAMES.finish,
			description: 'Gives the plan: one slot id from get_windows (or null when nothing fits), who is free then, who is left out and why, and one kind reason line.',
			strict: true,
			parameters: {
				type: 'object',
				properties: {
					slot_id: { type: ['string', 'null'], description: 'a slot id from get_windows, or null' },
					person_ids: { type: 'array', items: { type: 'string' }, description: 'people free in that slot, not the user' },
					skipped: {
						type: 'array',
						items: {
							type: 'object',
							properties: {
								person_id: { type: 'string' },
								why: { type: 'string', description: 'short and kind, e.g. "It\'s 01:30 in Toronto then."' },
								alt_slot_id: { type: ['string', 'null'], description: 'a slot id where they and the user are free, or null' }
							},
							required: ['person_id', 'why', 'alt_slot_id'],
							additionalProperties: false
						}
					},
					reason: { type: 'string', description: 'one kind line, e.g. "It\'s Thanksgiving morning."' },
					occasion: { type: ['string', 'null'], description: 'the occasion name if the plan is built around one, else null' }
				},
				required: ['slot_id', 'person_ids', 'skipped', 'reason', 'occasion'],
				additionalProperties: false
			}
		}
	}
];

export const WEEKEND_PROMPT = `You plan one call this weekend between the user and the people on their Kizuna map (family and close friends, each in their own time zone). Find the one time that suits the most people, or say that nothing fits. Nothing is a fine answer.

How to work
1. In your first turn call, all at once: get_windows for everyone over the weekend, get_occasions for the next 10 days, and get_reasons for each person.
2. Choose one slot from get_windows. Prefer, in order: the most people; what the user's request asks ("not Sunday, Dad has a game" means no Sunday slot); an occasion day ("Thanksgiving morning"); a time that is daytime for everyone; sooner.
3. For a person who has windows but is not in that slot, you may call get_local_time to see why (asleep, late night). Offer them an alt slot id where they and the user are both free, or null.
4. Call finish. slot_id is an id from get_windows, or null when nothing works. person_ids: the people free in that slot (never the user). reason: one short, kind line, e.g. "It's Thanksgiving morning." or "Jordan just started his new job." occasion: the occasion's name if the plan is built around it, else null.

Rules
- Never make up ids or times. Use only what the tools return.
- Never mention health, money or conflict details; keep it gentle and general.
- No guilt, no counting days, no urgency. Plain English, short.
- Always end by calling finish.`;

function weekendUser(i: WeekendInput): string {
	const today = zonedDay(Date.parse(i.now), i.timeZone);
	const { sat, sun } = comingWeekend(today);
	const people = i.people.length
		? i.people.map((p) => `- id=${p.id} ${p.name} (${p.relation}), ${p.timeZone}, writes ${p.language}`).join('\n')
		: '(nobody yet)';
	return `Now: ${i.now} (${i.timeZone}), ${WEEKDAY_NAMES[weekdayOfDay(today)]}
The weekend: Sat ${sat} and Sun ${sun}
Request: ${i.request.trim() ? `"${i.request.trim()}"` : '(none: plan the coming weekend)'}
Shortest call: ${i.minMinutes} minutes

People:
${people}

Calendar:
${calendarLines(today, 0, 10)}`;
}

// ---------------------------------------------------------------- build
const system = (task: TaskName, prompt: string): ChatMessage => ({ role: 'system', content: `${TASK_MARKER} ${task}\n${prompt}` });

export function buildTask<T extends TaskName>(task: T, input: TaskIO[T]['input']): BuiltTask {
	switch (task) {
		case 'extract': {
			const i = input as ExtractInput;
			return {
				messages: [system('extract', EXTRACT_PROMPT), { role: 'user', content: extractUser(i) }],
				schema: { name: 'extract', schema: SCHEMAS.extract },
				reasoning_effort: 'minimal',
				max_tokens: 1500
			};
		}
		case 'weave': {
			const i = input as WeaveInput;
			return {
				messages: [system('weave', WEAVE_PROMPT), { role: 'user', content: weaveUser(i) }],
				schema: { name: 'weave', schema: SCHEMAS.weave },
				reasoning_effort: 'high',
				max_tokens: 16000
			};
		}
		case 'draft': {
			const i = input as DraftInput;
			return {
				messages: [system('draft', DRAFT_PROMPT), { role: 'user', content: draftUser(i) }],
				schema: { name: 'draft', schema: SCHEMAS.draft },
				reasoning_effort: 'low',
				max_tokens: 1000
			};
		}
		case 'rank': {
			const i = input as RankInput;
			return {
				messages: [system('rank', RANK_PROMPT), { role: 'user', content: rankUser(i) }],
				schema: { name: 'rank', schema: SCHEMAS.rank },
				reasoning_effort: 'minimal',
				max_tokens: 1500
			};
		}
		case 'plan': {
			const i = input as PlanInput;
			return {
				messages: [system('plan', PLAN_PROMPT), { role: 'user', content: planUser(i) }],
				tools: PLAN_TOOLS,
				reasoning_effort: 'low',
				max_tokens: 1500
			};
		}
		case 'windows': {
			const i = input as WindowsInput;
			return {
				messages: [system('windows', WINDOWS_PROMPT), { role: 'user', content: windowsUser(i) }],
				schema: { name: 'windows', schema: SCHEMAS.windows },
				reasoning_effort: 'minimal',
				max_tokens: 1200
			};
		}
		case 'weekend': {
			const i = input as WeekendInput;
			return {
				messages: [system('weekend', WEEKEND_PROMPT), { role: 'user', content: weekendUser(i) }],
				tools: WEEKEND_TOOLS,
				reasoning_effort: 'low',
				max_tokens: 2000
			};
		}
		default:
			throw new Error(`unknown task ${String(task)}`);
	}
}

/** Max request body size the relay accepts per task, in bytes. */
export const TASK_LIMITS: Record<TaskName, number> = {
	extract: 16_000,
	weave: 600_000,
	draft: 16_000,
	plan: 64_000,
	rank: 16_000,
	windows: 4_000,
	weekend: 48_000
};
