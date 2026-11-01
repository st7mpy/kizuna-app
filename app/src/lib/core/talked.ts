// "Did you talk?": the day after the user opened a line to someone, one gentle question.
// Yes asks for anything worth remembering (it goes through the normal note path, tagged to them).
// No counters, no streaks; it asks once per reach, and only one person at a time.
import type { Person } from '@kizuna/shared';
import { db } from '../db.ts';
import { noteThought } from './capture.ts';

const HOUR = 3_600_000;
/** Ask between 12 and 48 hours after the line was opened. */
export const TALK_FROM_H = 12;
export const TALK_UNTIL_H = 48;

export interface TalkCheck {
	personId: string;
	name: string;
	reachedAt: string;
	/** "yesterday" or "on Friday", for the question. */
	when: string;
}

/** Pure: the one person to ask about, most recent first. Null when nobody fits. */
export function talkCheckFrom(people: Person[], now: Date): TalkCheck | null {
	const t = now.getTime();
	const due = people
		.filter((p) => p.circle !== 'out' && p.lastReachedAt && p.talkAskedFor !== p.lastReachedAt)
		.filter((p) => {
			const ago = t - Date.parse(p.lastReachedAt!);
			return ago >= TALK_FROM_H * HOUR && ago <= TALK_UNTIL_H * HOUR;
		})
		.sort((a, b) => b.lastReachedAt!.localeCompare(a.lastReachedAt!));
	const p = due[0];
	if (!p) return null;
	return { personId: p.id, name: p.name, reachedAt: p.lastReachedAt!, when: whenWords(new Date(p.lastReachedAt!), now) };
}

function whenWords(then: Date, now: Date): string {
	const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
	const days = Math.round((day(now) - day(then)) / 86_400_000);
	if (days <= 0) return 'earlier today';
	if (days === 1) return 'yesterday';
	return `on ${then.toLocaleDateString('en-GB', { weekday: 'long' })}`;
}

export async function talkCheck(now = new Date()): Promise<TalkCheck | null> {
	return talkCheckFrom(await db.people.toArray(), now);
}

/**
 * The answer. 'yes' with words keeps them as a note about that person; 'not_yet' lets the usual
 * nudges bring them back (the reach didn't happen); 'skip' just stops asking.
 */
export async function answerTalk(personId: string, answer: 'yes' | 'not_yet' | 'skip', note?: string): Promise<void> {
	const p = await db.people.get(personId);
	if (!p) return;
	const changes: Partial<Person> = { talkAskedFor: p.lastReachedAt };
	if (answer === 'not_yet') changes.lastReachedAt = undefined;
	await db.people.update(personId, changes);
	const words = note?.trim();
	if (answer === 'yes' && words) await noteThought(personId, words);
}
