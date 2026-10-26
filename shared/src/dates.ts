// The date guard: checks the model's dates against the words the user said
// ("Thursday" must land on a Thursday, "kal" = tomorrow, "parso" = day after).
// Owner: AI pipeline. Pure, deterministic, no time zone maths: every day is a
// 'YYYY-MM-DD' in the user's local calendar, handled as a UTC date internally.
export interface GuardResult { day: string | null; confidence: 'sure' | 'guess' | 'none' }

const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function toDate(day: string): Date | null {
	const m = DAY_RE.exec(day);
	if (!m) return null;
	const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
	return d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3] ? d : null;
}
function fmt(d: Date): string {
	return d.toISOString().slice(0, 10);
}
export function shiftDay(day: string, n: number): string {
	const d = toDate(day);
	if (!d) throw new Error(`bad day ${day}`);
	d.setUTCDate(d.getUTCDate() + n);
	return fmt(d);
}
/** 0 = Sunday ... 6 = Saturday */
export function weekdayOfDay(day: string): number {
	const d = toDate(day);
	if (!d) throw new Error(`bad day ${day}`);
	return d.getUTCDay();
}
function diffDays(a: string, b: string): number {
	return Math.round((toDate(a)!.getTime() - toDate(b)!.getTime()) / 86_400_000);
}
function inRange(day: string, from: string, to: string): boolean {
	return day >= from && day <= to;
}
/** Monday of the week that holds `day`. */
function weekStart(day: string): string {
	return shiftDay(day, -((weekdayOfDay(day) + 6) % 7));
}

// Word lists. Hindi is in Latin script, with the spellings people actually type.
const WEEKDAYS: [number, string[]][] = [
	[1, ['monday', 'mon', 'somvar', 'somwar', 'somvaar', 'somwaar']],
	[2, ['tuesday', 'tue', 'tues', 'mangalvar', 'mangalwar', 'mangalvaar', 'mangal']],
	[3, ['wednesday', 'wed', 'budhvar', 'budhwar', 'budhvaar', 'budh']],
	[4, ['thursday', 'thu', 'thur', 'thurs', 'guruvar', 'guruwar', 'guruvaar', 'brihaspativar', 'veervar', 'veerwar']],
	[5, ['friday', 'fri', 'shukravar', 'shukrawar', 'shukravaar', 'shukra']],
	[6, ['saturday', 'sat', 'shanivar', 'shaniwar', 'shanivaar', 'shani']],
	// 'sun' is left out on purpose: in Hinglish it usually means "listen".
	[0, ['sunday', 'ravivar', 'raviwar', 'ravivaar', 'itvaar', 'itwar', 'itvar', 'etvaar']]
];
const MONTHS: [number, string[]][] = [
	[1, ['january', 'jan']], [2, ['february', 'feb']], [3, ['march', 'mar']], [4, ['april', 'apr']],
	[5, ['may']], [6, ['june', 'jun']], [7, ['july', 'jul']], [8, ['august', 'aug']],
	[9, ['september', 'sept', 'sep']], [10, ['october', 'oct']], [11, ['november', 'nov']], [12, ['december', 'dec']]
];
const NUMBERS: Record<string, number> = {
	a: 1, an: 1, one: 1, ek: 1, two: 2, do: 2, three: 3, teen: 3, four: 4, char: 4, chaar: 4,
	five: 5, paanch: 5, panch: 5, six: 6, chhe: 6, chah: 6, seven: 7, saat: 7, ten: 10, das: 10
};

const NEXT = '(?:next|agle|agla|agli|aane wale|aane vale|coming|upcoming)';
const LAST = '(?:last|pichhle|pichle|pichhla|pichla|guzre|previous)';
const THIS = '(?:this|is|iss)';
const WEEK = '(?:week|hafte|hafta|hafteh|weak)';

const word = (alts: string[]): string => `\\b(?:${alts.join('|')})\\b`;
const has = (text: string, re: string): boolean => new RegExp(re).test(text);

function normalise(text: string): string {
	return (
		text
			.toLowerCase()
			.replace(/[’']/g, '')
			.replace(/[^a-z0-9/\s-]/g, ' ')
			// "aaj kal" means "these days", not a date.
			.replace(/\baaj\s*kal\b/g, ' ')
			.replace(/\s+/g, ' ')
			.trim()
	);
}

function monthOf(token: string): number | null {
	for (const [n, names] of MONTHS) if (names.includes(token)) return n;
	return null;
}

/** The year that puts month/day closest to today (ties go to the future). */
function nearestYear(today: string, month: number, dom: number): string | null {
	const y = +today.slice(0, 4);
	let best: string | null = null;
	let bestGap = Infinity;
	for (const year of [y, y + 1, y - 1]) {
		const d = new Date(Date.UTC(year, month - 1, dom));
		if (d.getUTCMonth() !== month - 1) continue;
		const day = fmt(d);
		const gap = Math.abs(diffDays(day, today));
		if (gap < bestGap) [best, bestGap] = [day, gap];
	}
	return best;
}

function explicitDate(t: string, today: string, model: string | null): GuardResult | null {
	const monthNames = MONTHS.flatMap(([, n]) => n).join('|');
	const build = (month: number, dom: number, year?: number): GuardResult | null => {
		if (year !== undefined) {
			if (year < 100) year += 2000;
			const d = new Date(Date.UTC(year, month - 1, dom));
			if (d.getUTCMonth() !== month - 1) return null;
			return { day: fmt(d), confidence: 'sure' };
		}
		// Trust the model's year if it chose the same month and day.
		if (model && +model.slice(5, 7) === month && +model.slice(8, 10) === dom && Math.abs(diffDays(model, today)) < 370) {
			return { day: model, confidence: 'sure' };
		}
		const day = nearestYear(today, month, dom);
		return day ? { day, confidence: 'sure' } : null;
	};

	// "12 nov", "12th november 2026"
	let m = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s*(?:of\\s+)?(${monthNames})\\b(?:\\s*(\\d{4}))?`).exec(t);
	if (m) return build(monthOf(m[2])!, +m[1], m[3] ? +m[3] : undefined);
	// "nov 12", "november 12th, 2026"
	m = new RegExp(`\\b(${monthNames})\\s*(\\d{1,2})(?:st|nd|rd|th)?\\b(?:\\s*(\\d{4}))?`).exec(t);
	if (m) return build(monthOf(m[1])!, +m[2], m[3] ? +m[3] : undefined);
	// "12/11" or "12/11/2026": day first, unless that can't be a date.
	m = /\b(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2}|\d{4}))?\b/.exec(t);
	if (m) {
		let [a, b] = [+m[1], +m[2]];
		if (b > 12 && a <= 12) [a, b] = [b, a];
		if (b >= 1 && b <= 12 && a >= 1 && a <= 31) return build(b, a, m[3] ? +m[3] : undefined);
	}
	// "the 12th", "12 tarikh": next time that day of the month comes round.
	m = /\b(\d{1,2})(?:st|nd|rd|th|\s*(?:tarikh|tareekh|tarik))\b/.exec(t);
	if (m) {
		const dom = +m[1];
		if (dom < 1 || dom > 31) return null;
		if (model && +model.slice(8, 10) === dom && Math.abs(diffDays(model, today)) <= 31) return { day: model, confidence: 'sure' };
		let d = new Date(Date.UTC(+today.slice(0, 4), +today.slice(5, 7) - 1, 1));
		for (let i = 0; i < 3; i++) {
			const c = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), dom));
			if (c.getUTCMonth() === d.getUTCMonth() && fmt(c) >= today) return { day: fmt(c), confidence: 'guess' };
			d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
		}
	}
	return null;
}

function findWeekday(t: string): { dow: number; index: number; token: string } | null {
	let found: { dow: number; index: number; token: string } | null = null;
	for (const [dow, names] of WEEKDAYS) {
		const m = new RegExp(word(names)).exec(t);
		if (m && (!found || m.index < found.index)) found = { dow, index: m.index, token: m[0] };
	}
	return found;
}

function weekdayDate(t: string, today: string, model: string | null, dow: number): GuardResult {
	const nextOccur = (from: string): string => shiftDay(from, (dow - weekdayOfDay(from) + 7) % 7);
	const modelOk = model !== null && weekdayOfDay(model) === dow;

	if (has(t, `\\b${LAST}\\s+\\w+`) || has(t, `\\b${LAST}\\s+${WEEK}\\b`)) {
		// "last Thursday", "pichhle hafte Thursday": the most recent one before today
		// (or within last week when the week is named).
		if (has(t, `\\b${LAST}\\s+${WEEK}\\b`)) {
			const from = shiftDay(weekStart(today), -7);
			const day = shiftDay(from, (dow + 6) % 7);
			return modelOk && model === day ? { day: model, confidence: 'sure' } : { day, confidence: 'sure' };
		}
		const back = (weekdayOfDay(today) - dow + 7) % 7 || 7;
		const day = shiftDay(today, -back);
		if (modelOk && diffDays(model!, today) < 0 && diffDays(model!, today) >= -14) return { day: model!, confidence: 'sure' };
		return { day, confidence: 'sure' };
	}

	if (has(t, `\\b${NEXT}\\s+${WEEK}\\b`) || has(t, `\\b${WEEK}\\s+${NEXT}\\b`)) {
		// "agle hafte Thursday ko": the Thursday of next (Monday-based) week.
		const day = shiftDay(shiftDay(weekStart(today), 7), (dow + 6) % 7);
		return { day, confidence: modelOk && model === day ? 'sure' : 'guess' };
	}

	if (has(t, `\\b${NEXT}\\s+\\w+`)) {
		// "next Thursday" is said both ways; accept the model's pick of either, else next week's.
		const coming = nextOccur(shiftDay(today, 1));
		const after = shiftDay(coming, 7);
		if (modelOk && (model === coming || model === after)) return { day: model!, confidence: 'guess' };
		const day = shiftDay(shiftDay(weekStart(today), 7), (dow + 6) % 7);
		return { day, confidence: 'guess' };
	}

	if (has(t, `\\b${THIS}\\s+${WEEK}\\b`)) {
		const day = shiftDay(weekStart(today), (dow + 6) % 7);
		return { day, confidence: 'sure' };
	}

	// A bare weekday ("Thursday ko", "this Friday"): the model may have used tense
	// to choose a recent past one, so accept any matching day within a week either way.
	if (modelOk) {
		const gap = diffDays(model!, today);
		if (gap >= -6 && gap <= 7) return { day: model!, confidence: 'sure' };
	}
	return { day: nextOccur(today), confidence: 'sure' };
}

/** "kal" and "parso" point both ways; the model hears the tense, so trust its sign. */
function twoWay(today: string, model: string | null, n: number): GuardResult {
	if (model === shiftDay(today, n)) return { day: model, confidence: 'sure' };
	if (model === shiftDay(today, -n)) return { day: model, confidence: 'sure' };
	return { day: shiftDay(today, n), confidence: 'guess' };
}

function countIn(t: string, unit: string): number | null {
	const m = new RegExp(`\\b(?:in\\s+)?(\\d{1,2}|${Object.keys(NUMBERS).join('|')})\\s+${unit}\\b`).exec(t);
	if (!m) return null;
	const n = /^\d+$/.test(m[1]) ? +m[1] : NUMBERS[m[1]];
	// "a day"/"ek din" without "in"/"mein"/"baad" is not a count from today.
	const after = t.slice(m.index + m[0].length);
	if (!/^\s*(?:mein|me|main|baad|bad|later|from now|time)\b/.test(after) && !/^in\s/.test(m[0])) return null;
	return n;
}

/**
 * Checks the model's day against the user's own date words and fixes it when they disagree.
 * Weekday words, today/tomorrow/kal/parso, weekends, next week and explicit dates are handled.
 */
export function guardDate(modelDay: string | null, dateText: string | null, today: string): GuardResult {
	if (!toDate(today)) throw new Error(`bad today ${today}`);
	const model = modelDay && toDate(modelDay) ? modelDay : null;
	const fallback = (): GuardResult => (model ? { day: model, confidence: 'guess' } : { day: null, confidence: 'none' });
	const t = normalise(dateText ?? '');
	if (!t) return fallback();

	const explicit = explicitDate(t, today, model);
	if (explicit) return explicit;

	const wd = findWeekday(t);
	if (wd) return weekdayDate(t, today, model, wd.dow);

	if (has(t, word(['day after tomorrow', 'day after', 'overmorrow']))) return { day: shiftDay(today, 2), confidence: 'sure' };
	if (has(t, word(['day before yesterday']))) return { day: shiftDay(today, -2), confidence: 'sure' };
	if (has(t, word(['tomorrow', 'tmrw', 'tmr', 'tomoro', 'tommorow', 'tomorow', 'kal subah se pehle'])))
		return { day: shiftDay(today, 1), confidence: 'sure' };
	if (has(t, word(['yesterday', 'yday', 'last night']))) return { day: shiftDay(today, -1), confidence: 'sure' };
	if (has(t, word(['today', 'tonight', 'aaj', 'aj', 'abhi', 'this morning', 'this evening', 'this afternoon'])))
		return { day: today, confidence: 'sure' };
	if (has(t, word(['parso', 'parson', 'parsoon', 'parsu', 'parsho']))) return twoWay(today, model, 2);
	if (has(t, word(['kal', 'kaal', 'kl']))) return twoWay(today, model, 1);

	const days = countIn(t, '(?:days?|din)');
	if (days !== null) return { day: shiftDay(today, days), confidence: 'sure' };
	const weeks = countIn(t, '(?:weeks?|hafte|hafton|hafta)');
	if (weeks !== null) {
		const day = shiftDay(today, 7 * weeks);
		if (model && Math.abs(diffDays(model, day)) <= 3) return { day: model, confidence: 'guess' };
		return { day, confidence: 'guess' };
	}

	const dow = weekdayOfDay(today);
	const comingSat = dow === 0 ? shiftDay(today, -1) : shiftDay(today, 6 - dow);
	if (has(t, `\\b${NEXT}\\s+weekend\\b`)) {
		const sat = shiftDay(comingSat, 7);
		if (model && inRange(model, comingSat, shiftDay(sat, 1)) && [0, 6].includes(weekdayOfDay(model)) && model >= today)
			return { day: model, confidence: 'guess' };
		return { day: sat, confidence: 'guess' };
	}
	if (has(t, '\\bweekend\\b')) {
		// "this weekend", "weekend pe", "is weekend"
		const from = dow === 0 ? today : comingSat < today ? today : comingSat;
		const to = dow === 0 ? today : shiftDay(comingSat, 1);
		if (model && inRange(model, from, to)) return { day: model, confidence: 'guess' };
		return { day: from, confidence: 'guess' };
	}

	if (has(t, `\\b${NEXT}\\s+${WEEK}\\b`) || has(t, `\\b${WEEK}\\s+${NEXT}\\b`)) {
		const from = shiftDay(weekStart(today), 7);
		const to = shiftDay(from, 6);
		if (model && inRange(model, from, to)) return { day: model, confidence: 'guess' };
		return { day: from, confidence: 'guess' };
	}
	if (has(t, `\\b${THIS}\\s+${WEEK}\\b`)) {
		const to = shiftDay(weekStart(today), 6);
		if (model && inRange(model, today, to)) return { day: model, confidence: 'guess' };
		return { day: null, confidence: 'none' };
	}
	if (has(t, `\\b${LAST}\\s+${WEEK}\\b`)) {
		const from = shiftDay(weekStart(today), -7);
		if (model && inRange(model, from, shiftDay(from, 6))) return { day: model, confidence: 'guess' };
		return { day: null, confidence: 'none' };
	}
	if (has(t, `\\b${NEXT}\\s+(?:month|mahine|mahina)\\b`)) {
		const m = +today.slice(5, 7);
		const y = +today.slice(0, 4);
		const first = fmt(new Date(Date.UTC(y, m, 1)));
		const last = fmt(new Date(Date.UTC(y, m + 1, 0)));
		if (model && inRange(model, first, last)) return { day: model, confidence: 'guess' };
		return { day: null, confidence: 'none' };
	}

	return fallback();
}

/** Sample-life dates are written "rel:N" (N days from the day the sample is loaded). */
export function resolveRelDay(value: string | null, today: string): string | null {
	if (value === null) return null;
	const m = /^rel:(-?\d+)$/.exec(value);
	return m ? shiftDay(today, +m[1]) : value;
}
