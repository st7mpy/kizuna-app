// Fake Meta model behaviour: plausible, schema-valid answers from simple heuristics.
// Pure functions so the relay tests can call them directly.

type Msg = { role: string; content?: string | null; tool_calls?: any[]; tool_call_id?: string };
export type TaskName = 'extract' | 'weave' | 'draft' | 'plan' | 'rank' | 'windows' | 'weekend';

export const CANNED_SENTENCE =
	"Mom has a dentist appointment Thursday, Jordan started his new job, should call him, and Maya wants to do something for Dad's birthday.";

const TASKS: TaskName[] = ['extract', 'weave', 'draft', 'plan', 'rank', 'windows', 'weekend'];

/** Task from the system marker, the schema name, or the presence of tools. */
export function detectTask(body: any): TaskName | null {
	const sys = (body?.messages ?? []).find((m: Msg) => m.role === 'system');
	const first = typeof sys?.content === 'string' ? sys.content.split('\n', 1)[0] : '';
	const marked = /^kizuna-task:\s*(\w+)/.exec(first)?.[1] as TaskName | undefined;
	if (marked && TASKS.includes(marked)) return marked;
	const named = body?.response_format?.json_schema?.name;
	if (TASKS.includes(named)) return named;
	if (Array.isArray(body?.tools) && body.tools.length) {
		return body.tools.some((t: any) => t?.function?.name === 'get_windows') ? 'weekend' : 'plan';
	}
	return null;
}

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const STOP = new Set([
	'i', 'the', 'a', 'an', 'and', 'but', 'or', 'so', 'should', 'need', 'must', 'also', 'today', 'tomorrow', 'yesterday',
	'next', 'this', 'that', 'he', 'she', 'they', 'we', 'it', 'my', 'his', 'her', 'their', 'our', 'call', 'meet', 'remind',
	'kal', 'aaj', 'parso', 'hai', 'tha', 'thi', 'ok', 'okay', 'note', 'idea', 'maybe', 'just', 'remember', 'buy', 'book',
	'pick', 'get', 'have', 'has', 'had', 'want', 'wants', 'can', 'will', 'would', 'to', 'for', 'of', 'in', 'on', 'at',
	'yaar', 'bhi', 'aur', 'phir', 'abhi', 'sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday',
	'english', 'hindi', 'google', 'whatsapp', 'diwali', 'holi', 'xmas', 'christmas', 'new', 'sat', 'sun', 'mon', 'tue',
	'wed', 'thu', 'fri', 'what', 'when', 'where', 'how', 'why', 'who', 'is', 'are', 'was', 'not', 'no', 'yes', 'hey', 'hi',
	...MONTHS
]);

/** Family words and the relation and canonical name they stand for. */
const FAMILY: { names: string[]; canon: string; relation: string }[] = [
	{ names: ['mum', 'mummy', 'ma', 'maa', 'mom', 'mother', 'amma'], canon: 'Mum', relation: 'parent' },
	{ names: ['papa', 'dad', 'daddy', 'pappa', 'father', 'pitaji'], canon: 'Papa', relation: 'parent' },
	{ names: ['nani', 'dadi', 'nana', 'dada', 'grandma', 'grandpa'], canon: '', relation: 'family' },
	{ names: ['didi', 'bhaiya', 'bhai', 'sis', 'bro'], canon: '', relation: 'sibling' }
];
const SIBLING_HINTS = /\b(sister|brother|behen|bhai|didi)\b/i;

function familyOf(word: string): { canon: string; relation: string } | null {
	const w = word.toLowerCase();
	// English words keep an English name ("dad" stays Dad); the other words map to the group's name.
	const english: Record<string, string> = { mom: 'Mom', mommy: 'Mom', mother: 'Mom', dad: 'Dad', daddy: 'Dad', father: 'Dad' };
	for (const f of FAMILY) if (f.names.includes(w)) return { canon: english[w] ?? (f.canon || cap(w)), relation: f.relation };
	return null;
}

function cap(s: string): string {
	return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

export function addDays(day: string, n: number): string {
	const [y, m, d] = day.split('-').map(Number);
	return new Date(Date.UTC(y, m - 1, d) + n * 86_400_000).toISOString().slice(0, 10);
}
function weekday(day: string): number {
	const [y, m, d] = day.split('-').map(Number);
	return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export interface Person { name: string; relation: string }

/** People named in a text: family words plus capitalised words that look like names. */
export function namesIn(text: string, known: { name: string; aliases: string[]; relation: string }[] = []): Person[] {
	const out = new Map<string, Person>();
	const words = text.match(/[A-Za-z][A-Za-z']*/g) ?? [];
	for (const raw of words) {
		const w = raw.replace(/'s$/i, '');
		const lower = w.toLowerCase();
		const k = known.find((p) => p.name.toLowerCase() === lower || p.aliases.includes(lower));
		if (k) {
			out.set(k.name, { name: k.name, relation: k.relation });
			continue;
		}
		const fam = familyOf(w);
		if (fam) {
			out.set(fam.canon, { name: fam.canon, relation: fam.relation });
			continue;
		}
		if (/^[A-Z][a-z]{2,}$/.test(w) && !STOP.has(lower)) {
			const near = new RegExp(`${w}[^.]{0,20}${SIBLING_HINTS.source}|${SIBLING_HINTS.source}[^.]{0,12}${w}`, 'i');
			out.set(w, { name: w, relation: near.test(text) ? 'sibling' : 'friend' });
		}
	}
	return [...out.values()];
}

export function languageOf(text: string): 'en' | 'hi' | 'mixed' {
	if (/[ऀ-ॿ]/.test(text)) return /[a-z]{3,}/i.test(text) ? 'mixed' : 'hi';
	const hi = (text.toLowerCase().match(/\b(hai|ka|ki|ke|ne|kal|parso|aaj|karna|nahi|kiya|tha|thi|hoga|wala|yaar|bhi|aur|mein|ko|hoon|shaam|subah|raat|dopahar)\b/g) ?? []).length;
	return hi >= 2 ? 'mixed' : 'en';
}

function dateFor(sentence: string, today: string): { date: string | null; date_text: string | null } {
	const s = sentence.toLowerCase();
	const rel: [RegExp, number][] = [
		[/\b(today|aaj)\b/, 0],
		[/\b(tomorrow|kal)\b/, 1],
		[/\b(day after tomorrow|parso)\b/, 2]
	];
	for (const [re, n] of rel) {
		const m = re.exec(s);
		if (m) return { date: addDays(today, n), date_text: m[1] };
	}
	for (let i = 0; i < 7; i++) {
		const m = new RegExp(`\\b(next |agle )?(${WEEKDAYS[i]})\\b`).exec(s);
		if (m) {
			let diff = (i - weekday(today) + 7) % 7 || 7;
			if (m[1]) diff += diff < 7 ? 7 : 0;
			return { date: addDays(today, diff), date_text: m[0].trim() };
		}
	}
	return { date: null, date_text: null };
}

function timeFor(sentence: string): string | null {
	const m = /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm|baje)\b/i.exec(sentence);
	if (!m) return null;
	let h = Number(m[1]);
	if (/pm/i.test(m[3]) && h < 12) h += 12;
	if (/am/i.test(m[3]) && h === 12) h = 0;
	if (/baje/i.test(m[3]) && h < 8) h += 12;
	return h < 24 ? `${String(h).padStart(2, '0')}:${m[2] ?? '00'}` : null;
}

function between(text: string, start: RegExp, end?: RegExp): string {
	const m = start.exec(text);
	if (!m) return '';
	const rest = text.slice(m.index + m[0].length);
	if (!end) return rest;
	const e = end.exec(rest);
	return e ? rest.slice(0, e.index) : rest;
}

function knownFrom(text: string): { name: string; aliases: string[]; relation: string }[] {
	const lines = between(text, /Known people:\n/, /\n\n/).split('\n');
	return lines
		.map((l) => /^- (.+?) \((\w+)\)(?:, also called: (.+))?$/.exec(l.trim()))
		.filter((m): m is RegExpExecArray => !!m)
		.map((m) => ({ name: m[1], relation: m[2], aliases: (m[3] ?? '').split(',').map((a) => a.trim().toLowerCase()).filter(Boolean) }));
}

export function fakeExtract(user: string): any {
	const note = (/"""\n?([\s\S]*?)\n?"""/.exec(user)?.[1] ?? user).trim();
	const today = /\b(\d{4}-\d{2}-\d{2})\b/.exec(user)?.[1] ?? new Date().toISOString().slice(0, 10);
	const known = knownFrom(user);
	const people = namesIn(note, known);
	const sentences = note.split(/(?<=[.!?])\s+|,\s*(?:and\s+)?|\band\b/i).map((s) => s.trim()).filter(Boolean);
	const events: any[] = [];
	const promises: any[] = [];
	const threads: any[] = [];
	let lastName: string | null = null;
	for (const s of sentences) {
		const here = namesIn(s, known).map((p) => p.name);
		if (here.length) lastName = here[here.length - 1];
		const lower = s.toLowerCase();
		const { date, date_text } = dateFor(s, today);
		const kind = /birthday|janamdin|bday/.test(lower)
			? 'birthday'
			: /appointment|doctor|checkup|dentist/.test(lower)
				? 'appointment'
				: /new job|joined|join kiya|promotion|baby|wedding|graduat|moving|shift/.test(lower)
					? 'milestone'
					: /trip|travel|flight/.test(lower)
						? 'trip'
						: date
							? 'plan'
							: null;
		if (kind) {
			const what =
				kind === 'birthday' ? 'birthday' :
				kind === 'appointment' ? (/knee/.test(lower) ? 'knee appointment' : 'appointment') :
				kind === 'milestone' ? (/job/.test(lower) ? 'started a new job' : /baby/.test(lower) ? 'new baby' : /moving|shift/.test(lower) ? 'moving out' : 'big news') :
				kind === 'trip' ? 'trip' : s.slice(0, 40);
			const parent = kind === 'birthday' ? /\b(papa|dad)\b/i.exec(s)?.[1] : undefined;
			const who = parent ? [familyOf(parent)!.canon] : here.length ? here.slice(-1) : lastName ? [lastName] : [];
			events.push({ what, kind, people: who.filter((n) => people.some((p) => p.name === n)), date, time: timeFor(s), date_text });
		}
		const call = /\b(?:should|need to|must|have to|gotta|remind me to)\s+(call|message|text|ping|meet|visit|see)\s+([A-Za-z]+)?/i.exec(s);
		if (call) {
			let person = call[2] && !/^(him|her|them)$/i.test(call[2]) ? namesIn(cap(call[2]), known)[0]?.name ?? null : lastName;
			if (person && !people.some((p) => p.name === person)) person = null;
			promises.push({ what: `${call[1].toLowerCase()} ${person ?? 'them'}`, person, date_text: date_text });
		}
		if (/\bwants to do something|plan(?:ning)? (?:a|something)|surprise\b/i.test(s)) {
			threads.push({ title: s.replace(/^(and\s+)/i, '').slice(0, 60), kind: 'plan', people: here });
		} else if (/\bidea\b|\bwhat if\b|\bsoch raha\b/i.test(s)) {
			threads.push({ title: s.slice(0, 60), kind: 'idea', people: here });
		} else if (/\b(buy|book|pay|renew|order|return|fix)\b/i.test(s)) {
			threads.push({ title: s.slice(0, 60), kind: 'errand', people: here });
		}
	}
	return {
		language: languageOf(note),
		sensitive: /knee|doctor|hospital|surgery|appointment|fever|sick|loan|money|debt|fight|argument|ladai|bimar/i.test(note),
		people,
		events,
		promises,
		threads,
		gift_hints: giftHints(note, people.map((p) => p.name), known)
	};
}

/** "Dad wants new running shoes", "Maya needs a desk lamp". Never money. */
export function giftHints(note: string, people: string[], known: { name: string; aliases: string[]; relation: string }[] = []): { person: string; what: string }[] {
	const out: { person: string; what: string }[] = [];
	const nameOf = (w: string) => namesIn(w, known)[0]?.name;
	const add = (who: string | undefined, what: string) => {
		const thing = what.replace(/\s+(for (his|her|their) birthday|for diwali)\b.*$/i, '').trim().replace(/[.!?]+$/, '');
		if (!who || !people.includes(who) || !thing || /₹|\$|rs\.?\s*\d|rupees|price|money|paisa|medicine|\d{3,}/i.test(thing)) return;
		const short = thing.split(/\s+/).slice(0, 8).join(' ');
		if (!out.some((g) => g.person === who && g.what === short)) out.push({ person: who, what: short });
	};
	for (const m of note.matchAll(/\b([A-Z][a-z]+)(?:'s)?\s+(?:wants|wanted|would like|would love|needs)\s+(?!to\b)((?:a|an|the|some|new)\s+[^.,;!?]+)/g)) add(nameOf(m[1]), m[2]);
	for (const m of note.matchAll(/\b([A-Z][a-z]+)\s+ko\s+([^.,;!?]+?)\s+chahiye\b/g)) add(nameOf(m[1]), m[2]);
	return out;
}

const GROUPS = FAMILY.slice(0, 2);

export function fakeWeave(user: string): any {
	const peopleLines = between(user, /People on file:\n/, /\n\n/).split('\n');
	const onFile = peopleLines
		.map((l) => /^- id=(\S+) name=(.+?) relation=(\w+) circle=(\w+)(?: aliases=(\S+))?$/.exec(l.trim()))
		.filter((m): m is RegExpExecArray => !!m)
		.map((m) => ({ id: m[1], name: m[2], relation: m[3], aliases: (m[5] ?? '').split('|').filter(Boolean) }));
	const notes = between(user, /Notes \(id, day, text\):\n/)
		.split('\n')
		.map((l) => /^\[([^\]]+)\] (\S+): (.*)$/.exec(l.trim()))
		.filter((m): m is RegExpExecArray => !!m)
		.map((m) => ({ id: m[1], day: m[2], text: m[3] }));
	const tally = new Map<string, { relation: string; notes: typeof notes; aliases: Set<string> }>();
	for (const n of notes) {
		const extracted = fakeExtract(`Today is X, ${n.day}.\n\nNote:\n"""\n${n.text}\n"""`);
		for (const p of extracted.people as Person[]) {
			const t = tally.get(p.name) ?? { relation: p.relation, notes: [], aliases: new Set<string>() };
			t.notes.push(n);
			for (const g of GROUPS) {
				if (g.canon === p.name) for (const w of g.names) if (new RegExp(`\\b${w}\\b`, 'i').test(n.text)) t.aliases.add(w);
			}
			tally.set(p.name, t);
		}
	}
	const ranked = [...tally.entries()].sort((a, b) => b[1].notes.length - a[1].notes.length).slice(0, 8);
	const people = ranked.map(([name, t]) => {
		const group = GROUPS.find((g) => g.canon === name);
		const matches = onFile.filter(
			(p) => p.name === name || p.aliases.includes(name.toLowerCase()) || (group && group.names.includes(p.name.toLowerCase()))
		);
		const last = t.notes[t.notes.length - 1];
		const count = t.notes.length;
		return {
			id: matches[0]?.id ?? null,
			name,
			aliases: [...new Set([name.toLowerCase(), ...t.aliases])],
			merge_ids: matches.slice(1).map((p) => p.id),
			relation: t.relation,
			closeness: count >= 4 ? 'inner' : count >= 2 ? 'close' : 'around',
			suggest_circle: count >= 2,
			why: count > 1 ? `Comes up in ${count} of your notes.` : 'Came up in a recent note.',
			summary: last.text.replace(/\s+/g, ' ').slice(0, 80)
		};
	});
	const threads: any[] = [];
	for (const n of notes) {
		const ex = fakeExtract(`Today is X, ${n.day}.\n\nNote:\n"""\n${n.text}\n"""`);
		for (const th of ex.threads) {
			if (threads.length < 8) threads.push({ title: th.title, kind: th.kind, people: th.people, note_ids: [n.id], status: 'open' });
		}
	}
	return { people, threads };
}

export function fakeDraft(user: string): any {
	const name = /^To: (.+?) \(/m.exec(user)?.[1] ?? 'there';
	const offer = /^Offer this time: (.+)$/m.exec(user)?.[1];
	const when = offer ? offer.replace(/ to \d{1,2}:\d{2}$/, '') : null;
	const line = when ? `Hey ${name}, been thinking of you. Free for a call ${when}?` : `Hey ${name}, been thinking of you. Up for a call this week?`;
	return { line, language: 'en' };
}

export function fakeRank(user: string): any {
	const items = [...user.matchAll(/^- id=(\S+) \| (.*)$/gm)].map((m) => ({ id: m[1], text: m[2].toLowerCase() }));
	const score = (t: string) => (/birthday|today|tomorrow/.test(t) ? 2 : /promise|said|should/.test(t) ? 1 : 0);
	return { order: items.sort((a, b) => score(b.text) - score(a.text)).map((i) => i.id) };
}

/** free_slots arguments from a request like "next weekend, not Sunday". */
export function planArgs(user: string): { from: string; to: string; partOfDay: string | null; excludeWeekdays: number[] } {
	const today = /Now: (\d{4}-\d{2}-\d{2})/.exec(user)?.[1] ?? new Date().toISOString().slice(0, 10);
	const req = (/^Request: "(.*)"$/m.exec(user)?.[1] ?? '').toLowerCase();
	let from = today;
	let to = addDays(today, 6);
	const wd = weekday(today);
	if (/weekend|hafte ke end/.test(req)) {
		let sat = addDays(today, (6 - wd + 7) % 7);
		if (sat === today && /next|agle/.test(req)) sat = addDays(sat, 7);
		from = sat;
		to = addDays(sat, 1);
	} else if (/\b(tomorrow|kal)\b/.test(req)) {
		from = to = addDays(today, 1);
	} else if (/next week|agle hafte/.test(req)) {
		from = addDays(today, ((8 - wd) % 7) || 7);
		to = addDays(from, 6);
	} else {
		for (let i = 0; i < 7; i++) {
			if (req.includes(WEEKDAYS[i]) && !new RegExp(`not ${WEEKDAYS[i]}`).test(req)) {
				from = to = addDays(today, ((i - wd + 7) % 7) || 7);
				break;
			}
		}
	}
	const excludeWeekdays = WEEKDAYS.map((d, i) => (new RegExp(`(not|no|except|nahi) ${d}|${d} (nahi|not)`).test(req) ? i : -1)).filter((i) => i >= 0);
	const partOfDay = /evening|shaam|night|after work/.test(req)
		? 'evening'
		: /morning|subah|breakfast/.test(req)
			? 'morning'
			: /afternoon|lunch|dopahar/.test(req)
				? 'afternoon'
				: null;
	return { from, to, partOfDay, excludeWeekdays };
}

let callSeq = 0;
function toolCall(name: string, args: unknown) {
	return { id: `call_${++callSeq}`, type: 'function', function: { name, arguments: JSON.stringify(args) } };
}

/** One plan turn: free_slots first, then finish with two spread ids. */
export function fakePlanTurn(messages: Msg[]): { content: string | null; tool_calls: any[] } {
	const user = messages.find((m) => m.role === 'user')?.content ?? '';
	const lastTool = [...messages].reverse().find((m) => m.role === 'tool');
	if (!lastTool) return { content: null, tool_calls: [toolCall('free_slots', planArgs(user))] };
	let result: any = {};
	try {
		result = JSON.parse(lastTool.content ?? '{}');
	} catch {}
	const slots: { id: string; start: string }[] = result.slots ?? [];
	const tries = messages.filter((m) => m.role === 'tool').length;
	if (slots.length === 0 && tries < 2) {
		// Nothing in the asked range: widen to the coming week.
		const today = /Now: (\d{4}-\d{2}-\d{2})/.exec(user)?.[1] ?? new Date().toISOString().slice(0, 10);
		return { content: null, tool_calls: [toolCall('free_slots', { from: today, to: addDays(today, 6), partOfDay: null, excludeWeekdays: [] })] };
	}
	const first = slots[0];
	const second =
		slots.find((s) => first && s.start.slice(0, 10) !== first.start.slice(0, 10)) ??
		slots.find((s) => first && Date.parse(s.start) - Date.parse(first.start) >= 3 * 3_600_000) ??
		slots[slots.length - 1];
	const ids = [first, second].filter((s, i, a) => s && a.indexOf(s) === i).map((s) => s.id);
	const note = tries > 1 ? 'Nothing free then, so here are the next good times.' : null;
	return { content: null, tool_calls: [toolCall('finish', { slot_ids: ids, note })] };
}

const DAY_WORDS: [RegExp, number][] = [
	[/\b(sat|saturday|shanivar)\b/, 6],
	[/\b(sun|sunday|ravivar|itvaar)\b/, 0]
];
const PARTS: [RegExp, [string, string]][] = [
	[/\b(subah|morning)\b/, ['09:00', '12:00']],
	[/\b(dopahar|afternoon|after lunch|lunch ke baad)\b/, ['13:00', '16:00']],
	[/\b(shaam|evening)\b/, ['17:00', '20:00']],
	[/\b(raat|night)\b/, ['20:00', '22:00']]
];

/** A reply like "Sunday shaam ko free hoon" -> windows, using the calendar's dates. */
export function fakeWindows(user: string): any {
	const reply = (/"""\n?([\s\S]*?)\n?"""/.exec(user)?.[1] ?? '').trim();
	const r = reply.toLowerCase();
	const today = /^\w{3} (\d{4}-\d{2}-\d{2}) \(today\)/m.exec(user)?.[1] ?? new Date().toISOString().slice(0, 10);
	const nope = /not this weekend|is weekend nahi|weekend nahi|busy all weekend|can'?t this weekend/.test(r);
	const days: string[] = [];
	const nextOf = (wd: number) => addDays(today, (wd - weekday(today) + 7) % 7);
	if (!nope) for (const [re, wd] of DAY_WORDS) if (re.test(r)) days.push(nextOf(wd));
	if (/\b(kal|tomorrow)\b/.test(r)) days.push(addDays(today, 1));
	if (/\b(aaj|today)\b/.test(r)) days.push(today);
	if (!days.length && /\bweekend\b/.test(r) && !nope) days.push(nextOf(6), nextOf(0));
	let span: [string, string] = ['10:00', '20:00'];
	for (const [re, p] of PARTS) {
		if (re.test(r)) {
			span = [p[0], p[1]];
			break;
		}
	}
	const after = /(?:after|not before|ke baad)\s+(\d{1,2})\b/.exec(r);
	if (after) {
		let h = Number(after[1]);
		if (h < 8) h += 12;
		const start = `${String(h).padStart(2, '0')}:00`;
		span = [start, span[1] > start ? span[1] : '20:00'];
	}
	const windows = [...new Set(days)].sort().slice(0, 3).map((day) => ({ day, start: span[0], end: span[1] }));
	return { windows, not_this_weekend: nope, language: languageOf(reply) };
}

/** One weekend turn: get_windows + get_occasions + get_reasons in parallel, then finish. */
export function fakeWeekendTurn(messages: Msg[]): { content: string | null; tool_calls: any[] } {
	const user = messages.find((m) => m.role === 'user')?.content ?? '';
	const ids = [...user.matchAll(/^- id=(\S+) /gm)].map((m) => m[1]);
	const sat = /The weekend: Sat (\d{4}-\d{2}-\d{2})/.exec(user)?.[1] ?? '';
	const sun = /and Sun (\d{4}-\d{2}-\d{2})/.exec(user)?.[1] ?? sat;
	const today = /^Now: (\d{4}-\d{2}-\d{2})/m.exec(user)?.[1] ?? sat;
	const request = (/^Request: "(.*)"$/m.exec(user)?.[1] ?? '').toLowerCase();
	const tools = messages.filter((m) => m.role === 'tool');
	if (!tools.length) {
		return {
			content: null,
			tool_calls: [
				toolCall('get_windows', { person_ids: ids, from: sat, to: sun }),
				toolCall('get_occasions', { from: today, to: addDays(today, 10) }),
				...ids.map((id) => toolCall('get_reasons', { person_id: id }))
			]
		};
	}
	const parse = (m: Msg) => {
		try {
			return JSON.parse(m.content ?? '{}');
		} catch {
			return {};
		}
	};
	const results = tools.map(parse);
	const win = results.find((r) => Array.isArray(r.slots)) ?? { slots: [], people: [] };
	const occ: { day: string; name: string }[] = results.find((r) => Array.isArray(r.occasions))?.occasions ?? [];
	const skipSun = /not sunday|sunday nahi/.test(request);
	const skipSat = /not saturday|saturday nahi/.test(request);
	const slots = (win.slots as { id: string; start: string; person_ids: string[] }[]).filter((s) => {
		const wd = weekday(s.start.slice(0, 10));
		return !(skipSun && wd === 0) && !(skipSat && wd === 6);
	});
	const onOccasion = (s: { start: string }) => Number(occ.some((o) => o.day === s.start.slice(0, 10)));
	const best = [...slots].sort((a, b) => b.person_ids.length - a.person_ids.length || onOccasion(b) - onOccasion(a) || a.start.localeCompare(b.start))[0];
	if (!best) {
		return { content: null, tool_calls: [toolCall('finish', { slot_id: null, person_ids: [], skipped: [], reason: 'Nothing lines up this weekend.', occasion: null })] };
	}
	const occasion = occ.find((o) => o.day === best.start.slice(0, 10)) ?? null;
	const reasons = results.filter((r) => Array.isArray(r.reasons) && r.reasons.length && best.person_ids.includes(r.person_id));
	const withWindows: string[] = (win.people ?? []).filter((p: any) => p.windows?.length).map((p: any) => p.person_id);
	const skipped = withWindows
		.filter((id) => !best.person_ids.includes(id))
		.map((id) => ({ person_id: id, why: 'Not free then.', alt_slot_id: slots.find((s) => s.person_ids.includes(id))?.id ?? null }));
	const reason = occasion ? `It's ${occasion.name} that day.` : reasons[0]?.reasons[0] ?? "You're free together then.";
	return {
		content: null,
		tool_calls: [toolCall('finish', { slot_id: best.id, person_ids: best.person_ids, skipped, reason, occasion: occasion?.name ?? null })]
	};
}

/** A full chat completion response for a request body. */
export function fakeCompletion(body: any): { status: number; json: any } {
	const task = detectTask(body);
	const messages: Msg[] = Array.isArray(body?.messages) ? body.messages : [];
	if (!task) return { status: 400, json: { error: { message: 'unknown task', type: 'invalid_request_error' } } };
	const user = messages.filter((m) => m.role === 'user').map((m) => m.content ?? '').join('\n');
	let message: any;
	if (task === 'plan') {
		message = { role: 'assistant', ...fakePlanTurn(messages) };
	} else if (task === 'weekend') {
		message = { role: 'assistant', ...fakeWeekendTurn(messages) };
	} else {
		const out =
			task === 'extract' ? fakeExtract(user) :
			task === 'weave' ? fakeWeave(user) :
			task === 'draft' ? fakeDraft(user) :
			task === 'windows' ? fakeWindows(user) :
			fakeRank(user);
		message = { role: 'assistant', content: JSON.stringify(out) };
	}
	const promptChars = messages.reduce((n, m) => n + (m.content?.length ?? 0), 0);
	const completionChars = (message.content ?? JSON.stringify(message.tool_calls ?? '')).length;
	const prompt_tokens = Math.ceil(promptChars / 4);
	const completion_tokens = Math.ceil(completionChars / 4);
	return {
		status: 200,
		json: {
			id: `chatcmpl-fake-${Date.now()}`,
			object: 'chat.completion',
			created: Math.floor(Date.now() / 1000),
			model: body.model,
			choices: [{ index: 0, message, finish_reason: message.tool_calls ? 'tool_calls' : 'stop' }],
			usage: { prompt_tokens, completion_tokens, total_tokens: prompt_tokens + completion_tokens }
		}
	};
}
