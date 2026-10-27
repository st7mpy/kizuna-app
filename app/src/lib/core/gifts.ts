// Gift hints: "Dad's birthday is in 9 days. You noted a new pair of running shoes. Plan it with Maya?"
// Hints stay on the phone. Drafts never carry prices, money, shopping links or health.
import type { GiftCard, GiftHint, Occasion, Person, Relation } from '@kizuna/shared';
import { db } from '../db.ts';
import { dayDiff, localDay } from './days.ts';
import { GIFT_FESTIVALS, occasionsBetween } from './occasions.ts';
import { buildMyLines, likelyLanguage, looksSensitive, whatsappLink } from './poke.ts';
import { isOnline, spark } from './relay.ts';
import { MONEY, lineOk } from './weekend.ts';

export const GIFT_MIN_DAYS = 1;
export const GIFT_MAX_DAYS = 10;
const FAMILY: Relation[] = ['parent', 'family', 'partner', 'child'];

/** Pure: who to plan a gift with: a sibling in the circle first, then other family, never the person themselves. */
export function planWith(person: Person, people: Person[], together: Map<string, number> = new Map()): Person | null {
	const pool = people.filter((p) => p.id !== person.id && p.circle === 'in');
	const rank = (p: Person) => (p.relation === 'sibling' ? 0 : FAMILY.includes(p.relation) ? 1 : 9);
	const sorted = pool
		.filter((p) => rank(p) < 9)
		.sort((a, b) => rank(a) - rank(b) || (together.get(b.id) ?? 0) - (together.get(a.id) ?? 0) || b.mentions - a.mentions);
	return sorted[0] ?? null;
}

/** Pure: gift cards from hints and occasions; the person's own occasion (or a gifting festival) 1 to 10 days away. */
export function giftCardsFrom(q: { hints: GiftHint[]; people: Person[]; occasions: Occasion[]; today: string; together?: Map<string, Map<string, number>> }): GiftCard[] {
	const out: GiftCard[] = [];
	const seen = new Set<string>();
	const hints = [...q.hints].filter((h) => h.status === 'open').sort((a, b) => b.createdAt.localeCompare(a.createdAt));
	for (const hint of hints) {
		if (seen.has(hint.personId)) continue;
		const person = q.people.find((p) => p.id === hint.personId);
		if (!person || person.circle === 'out') continue;
		const near = (o: Occasion) => {
			const d = dayDiff(q.today, o.day);
			return d >= GIFT_MIN_DAYS && d <= GIFT_MAX_DAYS;
		};
		const occasion =
			q.occasions.find((o) => near(o) && o.personIds.includes(person.id)) ??
			q.occasions.find((o) => near(o) && o.kind === 'festival' && GIFT_FESTIVALS.has(o.name));
		if (!occasion) continue;
		seen.add(hint.personId);
		const withP = planWith(person, q.people, q.together?.get(person.id));
		out.push({ kind: 'gift', personId: person.id, occasion, daysLeft: dayDiff(q.today, occasion.day), hint, withPersonId: withP?.id ?? null });
	}
	return out.sort((a, b) => a.daysLeft - b.daysLeft);
}

/** Today's gift cards. */
export async function giftCards(now = new Date()): Promise<GiftCard[]> {
	const today = localDay(now);
	const [hints, people, stored, threads] = await Promise.all([
		db.gifts.where('status').equals('open').toArray(),
		db.people.toArray(),
		db.occasions.toArray(),
		db.threads.toArray()
	]);
	if (!hints.length) return [];
	// Who comes up together with whom in the user's threads (to pick the sibling planning it).
	const together = new Map<string, Map<string, number>>();
	for (const t of threads)
		for (const a of t.personIds)
			for (const b of t.personIds) {
				if (a === b) continue;
				const m = together.get(a) ?? new Map<string, number>();
				m.set(b, (m.get(b) ?? 0) + 1);
				together.set(a, m);
			}
	return giftCardsFrom({
		hints,
		people,
		occasions: occasionsBetween(stored.map(({ id: _id, fragmentId: _f, ...o }) => o), today, GIFT_MAX_DAYS),
		today,
		together
	});
}

/** Pure: the gift idea as safe words, or null when it should not go in a message. */
export function safeIdea(what: string): string | null {
	const w = what.trim().replace(/[.\s]+$/, '');
	return w && !looksSensitive(w) && !MONEY.test(w) && w.length <= 80 ? w : null;
}

/** Pure: a fallback line to the sibling. */
export function giftTemplate(occasionName: string, idea: string | null, _language: 'en' | 'hi' | 'mixed' | 'other' = 'en'): string {
	return idea ? `${occasionName} is coming up. I was thinking ${idea}. Plan it together?` : `${occasionName} is coming up. Want to plan something together?`;
}

/** Drafts a line to the sibling (or whoever plans it with you). wa.me with their number if known. */
export async function draftGiftLine(card: GiftCard, quick?: (line: string) => void): Promise<{ line: string; link: string }> {
	const [person, withP] = await Promise.all([db.people.get(card.personId), card.withPersonId ? db.people.get(card.withPersonId) : undefined]);
	const idea = safeIdea(card.hint.what);
	const occasionName = card.occasion.name;
	const about = withP ? await db.fragments.where('personIds').equals(withP.id).toArray() : [];
	const language = withP ? likelyLanguage(withP, about) : 'en';
	quick?.(giftTemplate(occasionName, idea, language));
	let line: string | null = null;
	if (isOnline() && withP) {
		try {
			const mine = await db.fragments.orderBy('createdAt').reverse().limit(20).toArray();
			const out = await spark('draft', {
				personName: withP.name,
				relation: withP.relation,
				reason: `Plan something together for ${occasionName}${person ? ` (${person.name})` : ''}`,
				context: idea ? [`gift idea: ${idea}`] : [],
				myRecentLines: buildMyLines(mine),
				language
			});
			const l = out.line?.trim().slice(0, 200);
			if (l && lineOk(l)) line = l;
		} catch {
			/* template below */
		}
	}
	line ??= giftTemplate(occasionName, idea, language);
	return { line, link: whatsappLink(line, withP?.phone) };
}

export async function markGift(id: string, status: 'done' | 'dropped'): Promise<void> {
	await db.gifts.update(id, { status });
}
