// Poke: one short line the user edits and sends themselves. No guilt, no health/money/conflict details.
import type { DraftInput, Fragment, KEvent, Language, Person, Slot } from '@kizuna/shared';
import { db } from '../db.ts';
import { addDays, dayPhrase, localDay, partOfDay } from './days.ts';
import { isOnline, spark } from './relay.ts';

// Words that mark something as private (health, money, conflict). Kept generic in drafts.
const SENSITIVE =
	/\b(knee|surgery|operation|hospital|doctor|clinic|appointment|scan|test results?|sick|ill|illness|pain|fever|injur\w*|therapy|therapist|medic\w*|diagnos\w*|bimar\w*|dawai|dard|aspatal|loan|debt|money|salary|rent|paisa|paise|udhaar|emi|fight|argument|divorce|breakup|broke up|jhagda|ladai|funeral|passed away)\b/i;

export function looksSensitive(text: string): boolean {
	return SENSITIVE.test(text);
}

const MAX_SNIPPET = 80;

function snippet(text: string): string {
	const first = text.split(/(?<=[.!?\n])\s+/)[0]?.trim() ?? '';
	return first.length > MAX_SNIPPET ? first.slice(0, MAX_SNIPPET - 1).trimEnd() + '…' : first;
}

/** Pure: a few things about them, with private details made general. */
export function buildContext(person: Person, events: KEvent[], fragments: Fragment[], today: string): string[] {
	const sensitiveFrag = new Set(fragments.filter((f) => f.sensitive).map((f) => f.id));
	const out: string[] = [];
	const recent = events
		.filter((e) => !e.day || (e.day >= addDays(today, -14) && e.day <= addDays(today, 14)))
		.sort((a, b) => (b.day ?? '').localeCompare(a.day ?? ''))
		.slice(0, 4);
	for (const e of recent) {
		const when = e.day ? ` (${dayPhrase(e.day, today)})` : '';
		if (sensitiveFrag.has(e.fragmentId) || e.kind === 'appointment' || looksSensitive(e.what)) {
			out.push(`has something personal going on${when}; ask how they are, do not mention details`);
		} else {
			out.push(`${e.what}${when}`);
		}
	}
	if (person.summary) out.push(looksSensitive(person.summary) ? 'has a lot going on lately' : person.summary);
	return [...new Set(out)].slice(0, 5);
}

/** Pure: short lines from the user's own recent notes, for tone. Private notes are skipped. */
export function buildMyLines(fragments: Fragment[]): string[] {
	return fragments
		.filter((f) => !f.sensitive && !looksSensitive(f.text))
		.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
		.slice(0, 5)
		.map((f) => snippet(f.text))
		.filter(Boolean);
}

/** Pure: the language most notes about them were in. */
export function likelyLanguage(person: Person, fragments: Fragment[]): Language {
	const counts = new Map<Language, number>();
	for (const f of fragments) if (f.language) counts.set(f.language, (counts.get(f.language) ?? 0) + 1);
	let best: Language | null = null;
	for (const [lang, n] of counts) if (!best || n > counts.get(best)!) best = lang;
	if (best) return best;
	return 'en';
}

/** A gentle line for when Spark can't be reached. */
export function templateLine(person: Person, _language: Language, slot?: Slot): string {
	const name = person.name;
	const when = slot ? slotWords(slot) : null;
	return when ? `Hi ${name}, thinking of you. Free for a chat ${when}?` : `Hi ${name}, thinking of you. How are things?`;
}

function slotWords(slot: Slot): string {
	const d = new Date(slot.start);
	const today = localDay();
	const day = localDay(d);
	const phrase = dayPhrase(day, today).replace(/^on /, '');
	const part = partOfDay(d);
	return phrase === 'today' ? `this ${part}` : `${phrase} ${part}`;
}

export async function buildDraftInput(personId: string, reason: string, slot?: Slot): Promise<{ input: DraftInput; person: Person }> {
	const person = await db.people.get(personId);
	if (!person) throw new Error('person not found');
	const today = localDay();
	const [events, about, mine] = await Promise.all([
		db.events.where('personIds').equals(personId).toArray(),
		db.fragments.where('personIds').equals(personId).toArray(),
		db.fragments.orderBy('createdAt').reverse().limit(20).toArray()
	]);
	return {
		person,
		input: {
			personName: person.name,
			relation: person.relation,
			reason: looksSensitive(reason) ? 'thinking of them' : reason,
			context: buildContext(person, events, about, today),
			myRecentLines: buildMyLines(mine),
			language: likelyLanguage(person, about),
			...(slot ? { withTime: slot.label } : {})
		}
	};
}

export interface PokeDraft {
	line: string;
	/** False when the model couldn't be reached in time and this is the simple template line. */
	fromModel: boolean;
}

export async function draftPoke(personId: string, reason: string, slot?: Slot): Promise<PokeDraft> {
	const { input, person } = await buildDraftInput(personId, reason, slot);
	if (isOnline()) {
		try {
			const out = await spark('draft', input);
			const line = out.line?.trim();
			if (line) return { line: line.slice(0, 200), fromModel: true };
		} catch {
			/* use the template */
		}
	}
	return { line: templateLine(person, input.language, slot), fromModel: false };
}

/** wa.me link with the text; phone optional (without it WhatsApp asks who to send to). */
export function whatsappLink(text: string, phone?: string): string {
	const digits = (phone ?? '').replace(/\D/g, '');
	return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}
