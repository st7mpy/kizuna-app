// "Ask the family about this weekend": one WhatsApp line with the family-page link.
import { readSettings } from '../db.ts';
import { SAMPLE_CIRCLE_ID, circleLink, createCircle } from './circle.ts';
import { whatsappLink } from './poke.ts';

/** Pure: the invite text. Short, says what the link is for. */
export function inviteText(link: string): string {
	return `Family call this weekend? Tap here to say when you're free (no app needed): ${link}`;
}

/** Creates the circle first if there is none (or only the sample one), then drafts the line. */
export async function inviteFamilyLine(): Promise<{ line: string; link: string }> {
	const s = await readSettings();
	if (!s.circle || s.circle.id === SAMPLE_CIRCLE_ID) await createCircle();
	const url = await circleLink();
	if (!url) throw new Error('no circle');
	const line = inviteText(url);
	return { line, link: whatsappLink(line) };
}
