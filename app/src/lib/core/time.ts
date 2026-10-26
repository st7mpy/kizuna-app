// Find us a time: slots from free hours (+ busy times from a private iCal link),
// pick-a-time invites, Google Calendar links and .ics files.
import type { IcalResponse, InviteResponse, PlanOutput, Settings, Slot, Window } from '@kizuna/shared';
import { freeSlots, icsText, pickSpread } from '@kizuna/shared';
import { readSettings } from '../db.ts';
import { addDays, dayToDate, deviceTimeZone, isoWithOffset, localDay, minutesOf, slotLabel, weekdayOf } from './days.ts';
import { isOnline, relayJson, spark } from './relay.ts';

type Busy = { start: string; end: string };
const BUSY_TTL = 30 * 60_000;
let busyCache: { url: string; at: number; busy: Busy[] } | null = null;

export function clearBusyCache(): void {
	busyCache = null;
}

/** Busy times for the next 21 days from the user's private iCal link (cached 30 min). */
export async function busyTimes(s?: Settings): Promise<Busy[]> {
	s ??= await readSettings();
	const url = s.icalUrl?.trim();
	if (!url) return [];
	if (busyCache && busyCache.url === url && Date.now() - busyCache.at < BUSY_TTL) return busyCache.busy;
	if (!isOnline()) return busyCache?.url === url ? busyCache.busy : [];
	const now = new Date();
	try {
		const r = await relayJson<IcalResponse>('/api/ical', {
			body: { url, from: now.toISOString(), to: new Date(now.getTime() + 21 * 86_400_000).toISOString() },
			timeoutMs: 15_000
		});
		busyCache = { url, at: Date.now(), busy: r.busy ?? [] };
		return busyCache.busy;
	} catch {
		return busyCache?.url === url ? busyCache.busy : [];
	}
}

/** Free slots via the shared slot maths. */
export function findFreeSlots(q: {
	now: Date;
	timeZone: string;
	freeHours: Window[];
	busy: Busy[];
	from: string;
	to: string;
	durationMinutes: number;
}): Slot[] {
	return freeSlots({ ...q, now: isoWithOffset(q.now) });
}

/** Two slots for a person, from free hours + busy times, optionally a plain-language request. */
export async function suggestSlots(request = ''): Promise<{ slots: Slot[]; note: string | null }> {
	const s = await readSettings();
	// The phone's zone right now, so slots follow the user when they travel.
	const timeZone = deviceTimeZone();
	const busy = await busyTimes(s);
	const now = new Date();
	if (isOnline()) {
		try {
			const out: PlanOutput = await spark('plan', {
				request: request.trim(),
				now: isoWithOffset(now),
				timeZone,
				freeHours: s.freeHours,
				busy,
				durationMinutes: 60
			});
			if (out.slots?.length) return { slots: out.slots.slice(0, 2), note: out.note ?? null };
			if (out.note) return { slots: [], note: out.note };
		} catch {
			/* fall back to local maths below */
		}
	}
	const today = localDay(now);
	// Works offline: the same shared slot maths, two well-spread slots.
	const slots = pickSpread(
		findFreeSlots({ now, timeZone, freeHours: s.freeHours, busy, from: today, to: addDays(today, 14), durationMinutes: 60 }),
		2
	);
	return { slots, note: slots.length ? null : 'No free hours in the next two weeks. You can change them in Settings.' };
}

/** Creates a pick-a-time page and returns its URL. */
export async function createInvite(personId: string, slots: Slot[]): Promise<string> {
	const s = await readSettings();
	// The page shows only the sender's first name; personId is kept for the call site's own use.
	void personId;
	const myName = (s.myName || '').trim().split(/\s+/)[0] || 'a friend';
	const r = await relayJson<InviteResponse>('/api/invite', {
		body: { fromName: myName, title: `Catch up with ${myName}`, slots: slots.slice(0, 3), timeZone: deviceTimeZone() },
		timeoutMs: 15_000
	});
	if (/^https?:\/\//.test(r.url)) return r.url;
	const base = s.relayUrl?.replace(/\/+$/, '') || (typeof location !== 'undefined' ? location.origin : '');
	return base + (r.url.startsWith('/') ? r.url : `/${r.url}`);
}

export { googleCalendarLink, utcStamp } from '@kizuna/shared';

export function icsFile(slot: Slot, title: string): Blob {
	const ics = icsText({ uid: `${crypto.randomUUID()}@kizuna`, start: slot.start, end: slot.end, title });
	return new Blob([ics], { type: 'text/calendar;charset=utf-8' });
}

/** The user's next free window within [from, to] (for nudges). */
export function nextFreeWindow(s: Settings, now: Date, from: string, to: string, busy: Busy[] = []): Slot | null {
	const slots = findFreeSlots({
		now,
		timeZone: deviceTimeZone(),
		freeHours: s.freeHours,
		busy,
		from,
		to,
		durationMinutes: 60
	});
	return slots.find((x) => new Date(x.start).getTime() > now.getTime()) ?? null;
}

