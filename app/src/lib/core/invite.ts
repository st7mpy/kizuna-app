// "Ask the family about this weekend": one WhatsApp line with the family-page link, for the group
// or for one person (their own link greets them by name). The user sends it themselves.
import type { Person } from '@kizuna/shared';
import { db, readSettings } from '../db.ts';
import { SAMPLE_CIRCLE_ID, circleLink, createCircle } from './circle.ts';
import { markInvited, personLink } from './answers.ts';
import { whatsappLink } from './poke.ts';

const FAMILY = new Set(['parent', 'sibling', 'family', 'child', 'partner']);

/** Pure: the invite text. Short, says what the link is for. */
export function inviteText(link: string): string {
	return `Family call this weekend? Tap here to say when you're free (no app needed): ${link}`;
}

/** Pure: the invite text for one person. */
export function personInviteText(name: string, link: string): string {
	return `Hi ${name}, family call this weekend? Tap the times that work for you, no app needed: ${link}`;
}

/** Pure: who a group invite reaches (family in the circle), for "hasn't answered yet". */
export function groupInvitees(people: Pick<Person, 'id' | 'circle' | 'relation'>[]): string[] {
	return people.filter((p) => p.circle === 'in' && FAMILY.has(p.relation)).map((p) => p.id);
}

async function ensureCircle(): Promise<void> {
	const s = await readSettings();
	if (!s.circle || s.circle.id === SAMPLE_CIRCLE_ID) await createCircle();
}

/**
 * Creates the circle first if there is none (or only the sample one), then drafts the line.
 * `invitees` are the people to mark as invited once the user actually shares it (markInvited).
 */
export async function inviteFamilyLine(): Promise<{ line: string; link: string; invitees: string[] }> {
	await ensureCircle();
	const url = await circleLink();
	if (!url) throw new Error('no circle');
	const line = inviteText(url);
	return { line, link: whatsappLink(line), invitees: groupInvitees(await db.people.toArray()) };
}

/** One person's own invite: their link (with &for=) in a line, and a wa.me link to their number when known. */
export async function invitePersonLine(personId: string): Promise<{ line: string; link: string; phone?: string }> {
	const p = await db.people.get(personId);
	if (!p) throw new Error('person not found');
	await ensureCircle();
	const url = await personLink(personId);
	if (!url) throw new Error('no circle');
	const line = personInviteText(p.name, url);
	return { line, link: whatsappLink(line, p.phone), ...(p.phone ? { phone: p.phone } : {}) };
}

export { markInvited };
