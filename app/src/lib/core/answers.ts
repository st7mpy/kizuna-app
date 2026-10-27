// Closing the loop on a family-call invite: who answered on the family page (a short line on
// Today and a flare on the map), and who hasn't yet (a gentle line the user can send themselves).
// Kizuna never messages anyone; every line here opens in the user's own WhatsApp.
import type { CircleEntry, CircleWindow, Person, Prompt, Settings } from '@kizuna/shared';
import { circleLink as buildCircleLink, isValidTimeZone, zonedDay } from '@kizuna/shared';
import { db, newId, readSettings, type MemberRow } from '../db.ts';
import { SAMPLE_CIRCLE_ID } from './circle.ts';
import { deviceTimeZone, hourOf, inQuietHours, localDay, weekdayOf, WEEKDAYS } from './days.ts';
import { capUsed } from './nudges.ts';
import { buildDraftInput, whatsappLink } from './poke.ts';
import { isOnline, spark } from './relay.ts';
import { lineOk, weekendForced } from './weekend.ts';
import { zonedMinutes } from './zones.ts';

const HOUR = 3600_000;
export const ANSWER_HOURS = 48;
export const INVITE_DAYS = 7;
/** At most this many "hasn't answered yet" lines at once. */
export const MAX_FOLLOW_UPS = 2;

// ---------- answers (pure) ----------

const sameAnswer = (a: CircleEntry, b: CircleEntry) =>
	a.updatedAt === b.updatedAt && JSON.stringify(a.windows) === JSON.stringify(b.windows) && !!a.notThisWeekend === !!b.notThisWeekend;

/**
 * Pure: what the refresh stores about a member's answer. A new or changed family-page entry gets
 * answeredAt (its own time, never later than now) and shows again on Today; anything else keeps what it had.
 */
export function answerStamp(old: Pick<MemberRow, 'entry' | 'answeredAt' | 'answerSeen'> | undefined, entry: CircleEntry, now: Date): Pick<MemberRow, 'answeredAt' | 'answerSeen'> {
	const keep = { answeredAt: old?.answeredAt, answerSeen: old?.answerSeen };
	if (entry.via !== 'page' || (old && sameAnswer(old.entry, entry))) return keep;
	const at = Math.min(Date.parse(entry.updatedAt) || now.getTime(), now.getTime());
	return { answeredAt: new Date(at).toISOString(), answerSeen: false };
}

function partOf(ms: number, tz: string): string {
	const h = zonedMinutes(ms, tz) / 60;
	return h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening';
}

/** Pure: "Sunday afternoon", "Saturday morning to evening", in the given zone. */
export function windowWords(w: CircleWindow, tz: string): string {
	const s = Date.parse(w.start);
	const e = Math.max(s, Date.parse(w.end) - 60_000);
	const day = WEEKDAYS[weekdayOf(zonedDay(s, tz))];
	const a = partOf(s, tz);
	const b = zonedDay(e, tz) === zonedDay(s, tz) ? partOf(e, tz) : 'evening';
	return a === b ? `${day} ${a}` : `${day} ${a} to ${b}`;
}

/** Pure: what they said, in a few words: "Sunday afternoon", "Saturday morning or Sunday evening", "not this weekend". */
export function answerWords(entry: Pick<CircleEntry, 'windows' | 'notThisWeekend'>, tz: string): string {
	if (!entry.windows.length) return entry.notThisWeekend ? 'not this weekend' : 'no times yet';
	const parts = [...new Set(entry.windows.slice(0, 3).map((w) => windowWords(w, tz)))];
	return parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} or ${parts.at(-1)}`;
}

export interface AnswerLine {
	memberId: string;
	personId: string | null;
	name: string;
	words: string; // "Sunday afternoon"
	text: string; // "Mom answered: Sunday afternoon"
	at: string;
}

/** Pure: one line per family-page answer from the last 48 hours that the user hasn't closed. Newest first. `tz` is the fallback zone. */
export function answeredLines(members: MemberRow[], people: Pick<Person, 'id' | 'name'>[], now: Date, tz: string): AnswerLine[] {
	const byId = new Map(people.map((p) => [p.id, p]));
	const t = now.getTime();
	return members
		.filter((m) => {
			if (m.entry.via !== 'page' || !m.answeredAt || m.answerSeen) return false;
			const at = Date.parse(m.answeredAt);
			return at <= t + 5 * 60_000 && t - at <= ANSWER_HOURS * HOUR;
		})
		.sort((a, b) => b.answeredAt!.localeCompare(a.answeredAt!))
		.map((m) => {
			const name = (m.personId && byId.get(m.personId)?.name) || m.entry.name.trim() || 'Someone';
			// in their own words and their own time, as they picked it
			const zone = isValidTimeZone(m.entry.tz) ? m.entry.tz : tz;
			const words = answerWords(m.entry, zone);
			return { memberId: m.memberId, personId: m.personId, name, words, text: `${name} answered: ${words}`, at: m.answeredAt! };
		});
}

/** Pure: people whose answer came in after `since` (the map lights them up). */
export function freshAnswerPeople(members: MemberRow[], since: string | null): string[] {
	const from = since ? Date.parse(since) : -Infinity;
	return [
		...new Set(
			members
				.filter((m) => m.personId && m.entry.via === 'page' && m.answeredAt && Date.parse(m.answeredAt) > from)
				.map((m) => m.personId!)
		)
	];
}

// ---------- follow-ups (pure) ----------

/** Pure: from Friday 12:00 to the end of Sunday, in the home or phone zone. */
export function followUpTime(now: Date): boolean {
	const wd = weekdayOf(localDay(now));
	return wd === 6 || wd === 0 || (wd === 5 && hourOf(now) >= 12);
}

/** Pure: did this person answer (on the page or in the app) since they were invited? */
export function answeredSince(personId: string, members: MemberRow[], since: string): boolean {
	const from = Date.parse(since);
	return members.some((m) => m.personId === personId && Date.parse(m.answeredAt ?? m.entry.updatedAt) >= from);
}

export interface FollowUp {
	personId: string;
	name: string;
	phone?: string;
	text: string; // "Grandma hasn't answered yet"
}

/**
 * Pure: people invited this week who haven't answered, for a gentle follow-up the user sends.
 * From Friday 12:00, outside quiet hours and under the weekly cap; at most two. `forced` (the sample
 * family's demo) skips the day, quiet-hours and cap checks so the loop can be seen any time.
 */
export function followUpsDue(q: {
	now: Date;
	people: Person[];
	members: MemberRow[];
	settings: Pick<Settings, 'quietStart' | 'quietEnd' | 'weeklyCap'>;
	prompts: Prompt[];
	forced?: boolean;
}): FollowUp[] {
	const { now, settings } = q;
	if (!q.forced && !followUpTime(now)) return [];
	if (!q.forced && inQuietHours(now, settings.quietStart, settings.quietEnd)) return [];
	if (!q.forced && capUsed({ now, prompts: q.prompts, settings: settings as Settings }) >= settings.weeklyCap) return [];
	const t = now.getTime();
	return q.people
		.filter((p) => {
			if (p.circle !== 'in' || !p.invitedAt) return false;
			const at = Date.parse(p.invitedAt);
			if (!(at <= t) || t - at > INVITE_DAYS * 24 * HOUR) return false;
			if (p.nudgedAt && p.nudgedAt >= p.invitedAt) return false;
			return !answeredSince(p.id, q.members, p.invitedAt);
		})
		.sort((a, b) => a.invitedAt!.localeCompare(b.invitedAt!))
		.slice(0, MAX_FOLLOW_UPS)
		.map((p) => ({ personId: p.id, name: p.name, ...(p.phone ? { phone: p.phone } : {}), text: `${p.name} hasn't answered yet` }));
}

/** Pure: the fallback follow-up line. Kind, no guilt, no hurry. */
export function nudgeTemplate(name: string, link?: string | null): string {
	return link
		? `Hi ${name}, no rush at all. If you get a minute, tap the times that suit you this weekend: ${link}`
		: `Hi ${name}, no rush at all. If a call this weekend suits you, just tell me when.`;
}

// ---------- on the phone ----------

const firstName = (s: Pick<Settings, 'myName'>) => (s.myName || '').trim().split(/\s+/)[0] || '';

/** The family-page link made for one person (greets them and fills in their name), or null without a circle. */
export async function personLink(personId: string): Promise<string | null> {
	const s = await readSettings();
	const p = await db.people.get(personId);
	if (!p || !s.circle || s.circle.id === SAMPLE_CIRCLE_ID) return null;
	const origin = s.relayUrl?.replace(/\/+$/, '') || (typeof location !== 'undefined' ? location.origin : '');
	if (!/^https?:\/\//.test(origin)) return null;
	return buildCircleLink(origin, s.circle.id, s.circle.key, firstName(s) || undefined, p.name);
}

/** Remembers that the user shared the family link with these people (for "hasn't answered yet"). */
export async function markInvited(personIds: string[], now = new Date()): Promise<void> {
	const at = now.toISOString();
	await db.transaction('rw', db.people, async () => {
		for (const id of new Set(personIds)) await db.people.update(id, { invitedAt: at });
	});
}

/** Today's "answered" lines. */
export async function answerLines(now = new Date()): Promise<AnswerLine[]> {
	const [members, people] = await Promise.all([db.members.toArray(), db.people.toArray()]);
	return answeredLines(members, people, now, deviceTimeZone());
}

/** Closes one "answered" line (it shows again if they change their answer). */
export async function dismissAnswer(memberId: string): Promise<void> {
	await db.members.update(memberId, { answerSeen: true });
}

/** Today's follow-ups. */
export async function followUps(now = new Date()): Promise<FollowUp[]> {
	const s = await readSettings();
	const [people, members, prompts] = await Promise.all([
		db.people.where('circle').equals('in').toArray(),
		db.members.toArray(),
		db.prompts.where('shownAt').aboveOrEqual(new Date(now.getTime() - 8 * 24 * HOUR).toISOString()).toArray()
	]);
	return followUpsDue({ now, people, members, settings: s, prompts, forced: weekendForced(s) });
}

/** A gentle line for the user to send to someone who hasn't answered, with their own link when there is one. */
export async function draftNudge(personId: string): Promise<{ line: string; link: string; phone?: string }> {
	const { input, person } = await buildDraftInput(personId, 'Asked them about a family call this weekend. A gentle, no-pressure check; no hurry.');
	const own = await personLink(personId);
	let line: string | null = null;
	if (isOnline()) {
		try {
			const out = await spark('draft', input);
			const l = out.line?.trim().slice(0, 200);
			if (l && lineOk(l)) line = own ? `${l} ${own}` : l;
		} catch {
			/* use the template */
		}
	}
	line ??= nudgeTemplate(person.name, own);
	return { line, link: whatsappLink(line, person.phone), ...(person.phone ? { phone: person.phone } : {}) };
}

/** The user opened the follow-up: no second one for this invite, and it counts toward the weekly cap. */
export async function markNudged(personId: string, now = new Date()): Promise<void> {
	const at = now.toISOString();
	await db.transaction('rw', [db.people, db.prompts], async () => {
		await db.people.update(personId, { nudgedAt: at, lastReachedAt: at });
		await db.prompts.add({ id: newId(), personId, threadId: null, reason: 'follow_up', reasonText: 'Follow-up to a family-call invite', shownAt: at, answer: 'poke', answeredAt: at });
	});
}
