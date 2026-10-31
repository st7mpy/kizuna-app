// "Before you call": a few things to remember about someone, from the user's own notes.
// The phone's version shows at once; Spark tidies it when it can. Private details stay general.
import type { BriefInput, BriefOutput, Fragment, Person } from '@kizuna/shared';
import { db } from '../db.ts';
import { addDays, localDay } from './days.ts';
import { buildContext, looksSensitive } from './poke.ts';
import { isOnline, spark } from './relay.ts';
import { MONEY } from './weekend.ts';

export interface Brief {
	lines: string[];
	ask: string;
	/** True once Spark has written it; false for the phone's own version. */
	fromModel: boolean;
}

const MAX_LINE = 90;
const PERSONAL = /^has something personal going on/;

function clip(text: string, max = MAX_LINE): string {
	const t = text.replace(/\s+/g, ' ').trim();
	return t.length > max ? t.slice(0, max - 1).trimEnd() + '…' : t;
}

function capital(text: string): string {
	return text ? text[0].toUpperCase() + text.slice(1) : text;
}

const SMALL = new Set(['a', 'an', 'the', 'for', 'of', 'on', 'in', 'to', 'and', 'with', 'at', 'his', 'her', 'their', 'my', 's']);
function words(text: string): Set<string> {
	const plain = text.toLowerCase().replace(/\([^)]*\)/g, ' ').replace(/[^a-z0-9]+/g, ' ');
	return new Set(plain.split(' ').filter((w) => w && !SMALL.has(w)));
}

/** Pure: true when two lines say much the same thing ("Dad's 60th birthday" and "Family dinner for Dad's 60th"). */
export function similar(a: string, b: string): boolean {
	const x = words(a);
	const y = words(b);
	if (!x.size || !y.size) return false;
	let shared = 0;
	for (const w of x) if (y.has(w)) shared++;
	return shared / Math.min(x.size, y.size) >= 0.6;
}

function safe(text: string): boolean {
	return !looksSensitive(text) && !MONEY.test(text);
}

/** Pure: the input Spark sees. Only safe notes from the last 30 days, newest first. */
export function briefInput(person: Person, context: string[], fragments: Fragment[], today: string): BriefInput {
	const since = addDays(today, -30);
	const notes = fragments
		.filter((f) => !f.sensitive && safe(f.text))
		.map((f) => ({ day: localDay(new Date(f.createdAt)), text: clip(f.text, 160) }))
		.filter((n) => n.day >= since)
		.sort((a, b) => b.day.localeCompare(a.day))
		.slice(0, 6);
	return { personName: person.name, relation: person.relation, today, context, notes };
}

/** Pure: the phone's own brief, with no model. */
export function localBrief(input: BriefInput, skip = ''): Brief {
	const lines: string[] = [];
	const shown = skip.trim().toLowerCase();
	let personal = false;
	for (const c of input.context) {
		if (PERSONAL.test(c)) personal = true;
		else if (safe(c) && c.trim().toLowerCase() !== shown) lines.push(capital(clip(c)));
	}
	for (const n of input.notes) lines.push(capital(clip(n.text)));
	const out: string[] = [];
	for (const l of lines) if (out.length < 3 && !out.some((o) => similar(o, l))) out.push(l);
	const ask = personal ? 'How are you holding up?' : out.length ? 'How has your week been?' : '';
	return { lines: out, ask, fromModel: false };
}

/** Pure: keep Spark's answer only if it is short, safe and non-empty. */
export function cleanBrief(out: BriefOutput | null | undefined): Brief | null {
	if (!out || !Array.isArray(out.lines)) return null;
	const lines = out.lines.map((l) => clip(String(l ?? ''))).filter((l) => l && safe(l)).slice(0, 3);
	if (!lines.length) return null;
	const ask = typeof out.ask === 'string' && safe(out.ask) ? clip(out.ask) : '';
	return { lines, ask, fromModel: true };
}

const cache = new Map<string, Brief>();

/** For tests, and after a wipe. */
export function clearBriefCache(): void {
	cache.clear();
}

async function gather(personId: string): Promise<{ input: BriefInput; key: string; summary: string } | null> {
	const person = await db.people.get(personId);
	if (!person) return null;
	const today = localDay();
	const [events, about] = await Promise.all([
		db.events.where('personIds').equals(personId).toArray(),
		db.fragments.where('personIds').equals(personId).toArray()
	]);
	const latest = about.reduce((m, f) => (f.createdAt > m ? f.createdAt : m), '');
	return {
		input: briefInput(person, buildContext(person, events, about, today), about, today),
		key: `${personId}|${today}|${about.length}|${latest}|${person.summary ?? ''}`,
		summary: person.summary ?? ''
	};
}

/**
 * Calls `show` with the phone's brief straight away, then with Spark's when it arrives.
 * Returns nothing to show (null) when there is nothing to say about them yet.
 */
export async function briefFor(personId: string, show: (b: Brief | null) => void): Promise<void> {
	const got = await gather(personId);
	if (!got) return show(null);
	const hit = cache.get(got.key);
	if (hit) return show(hit);
	// the page already shows their summary, so the phone's version leaves it out
	const local = localBrief(got.input, got.summary);
	if (!local.lines.length) return show(null);
	show(local);
	if (!isOnline() || !got.input.notes.length) return;
	try {
		const better = cleanBrief(await spark('brief', got.input));
		if (better) {
			cache.set(got.key, better);
			show(better);
		}
	} catch {
		/* the phone's brief stays */
	}
}
