// Find us a time: slots from free hours (+ busy times from a private iCal link),
// pick-a-time invites, Google Calendar links and .ics files.
import type { IcalResponse, InviteResponse, PlanOutput, Settings, Slot, Window } from '@kizuna/shared';
import { freeSlots, icsText, modelText, pickSpread } from '@kizuna/shared';
import { db, readSettings } from '../db.ts';
import { recordInvite } from './picks.ts';
import { addDays, dayToDate, deviceTimeZone, isoWithOffset, localDay, minutesOf, slotLabel, weekdayOf } from './days.ts';
import { isOnline, relayJson, spark } from './relay.ts';

type Busy = { start: string; end: string };
const BUSY_TTL = 30 * 60_000;
/** A calendar that couldn't be read is not asked again for a few minutes (Today, Find a time, the weekend card). */
const FAIL_TTL = 5 * 60_000;
/** The busy lookup is a nice-to-have: free hours alone still give good slots, so never wait long for it. */
export const ICAL_TIMEOUT = 5_000;
/** Settings' one-off check can wait longer: a big calendar's first read is often slow. */
export const ICAL_CHECK_TIMEOUT = 15_000;
let busyCache: { url: string; at: number; busy: Busy[]; failed?: boolean } | null = null;
let inflight: { url: string; p: Promise<Busy[]> } | null = null;

export function clearBusyCache(): void {
	busyCache = null;
	inflight = null;
}

/**
 * Pure: a link that could be a calendar address (https or webcal, with a host). Many end in .ics, but
 * iCloud's do not, so whether it really is a calendar is found out by reading it once (checkCalendar).
 */
export function isCalendarLink(url: string): boolean {
	return /^(https?|webcal):\/\/[^\s/?#]+\.[^\s/?#]+(\/\S*)?$/i.test(url.trim());
}

async function fetchBusy(url: string, timeoutMs = ICAL_TIMEOUT): Promise<Busy[]> {
	const now = new Date();
	const r = await relayJson<IcalResponse>('/api/ical', {
		body: { url: url.replace(/^webcal:/i, 'https:'), from: now.toISOString(), to: new Date(now.getTime() + 21 * 86_400_000).toISOString() },
		timeoutMs
	});
	return r.busy ?? [];
}

/** One lookup at a time per link; the result (or the failure) is remembered. */
function lookup(url: string, timeoutMs = ICAL_TIMEOUT): Promise<Busy[]> {
	if (inflight?.url === url) return inflight.p;
	const p = fetchBusy(url, timeoutMs)
		.then((busy) => {
			busyCache = { url, at: Date.now(), busy };
			return busy;
		})
		.catch((e) => {
			// keep an older good answer if there is one; otherwise remember that it failed
			if (!(busyCache?.url === url && !busyCache.failed)) busyCache = { url, at: Date.now(), busy: [], failed: true };
			throw e;
		})
		.finally(() => {
			if (inflight?.p === p) inflight = null;
		});
	inflight = { url, p };
	return p;
}

/** Busy times for the next 21 days from the user's private iCal link (cached 30 min; a failure for 5). */
export async function busyTimes(s?: Settings): Promise<Busy[]> {
	s ??= await readSettings();
	const url = s.icalUrl?.trim();
	if (!url) return [];
	if (busyCache && busyCache.url === url) {
		const age = Date.now() - busyCache.at;
		if (age < (busyCache.failed ? FAIL_TTL : BUSY_TTL)) return busyCache.busy;
	}
	if (!isOnline()) return busyCache?.url === url ? busyCache.busy : [];
	try {
		return await lookup(url);
	} catch {
		return busyCache?.url === url ? busyCache.busy : [];
	}
}

/** Settings: reads the calendar once, so the user knows straight away whether the link works. */
export async function checkCalendar(url: string): Promise<'ok' | 'failed' | 'offline'> {
	const u = url.trim();
	if (!isOnline()) return 'offline';
	if (inflight?.url !== u && busyCache?.url === u) busyCache = null; // a fresh look
	try {
		await lookup(u, ICAL_CHECK_TIMEOUT);
		return 'ok';
	} catch {
		return 'failed';
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
			const note = modelText(out.note);
			if (out.slots?.length) return { slots: out.slots.slice(0, 2), note };
			if (note) return { slots: [], note };
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

/** Creates a pick-a-time page and returns its URL. personName covers a suggested person not saved yet. */
export async function createInvite(personId: string, slots: Slot[], personName?: string): Promise<string> {
	const s = await readSettings();
	// The page shows only the sender's first name; personId is kept here so the pick can show on Today.
	// A blank or one-letter name is left out; the page then says "A friend".
	const first = (s.myName || '').trim().split(/\s+/)[0] ?? '';
	const myName = first.length >= 2 && /\p{L}/u.test(first) ? first : '';
	// Plain copies: slots may come from UI state, which IndexedDB can't store as is.
	const picked: Slot[] = slots.slice(0, 3).map((x) => ({ start: x.start, end: x.end, label: x.label }));
	const title = myName ? `Catch up with ${myName}` : 'Catch up';
	const r = await relayJson<InviteResponse>('/api/invite', {
		body: { fromName: myName, title, slots: picked, timeZone: deviceTimeZone() },
		timeoutMs: 15_000
	});
	const name = (await db.people.get(personId))?.name ?? personName?.trim() ?? '';
	if (r.id && name)
		await recordInvite({ id: r.id, personId, personName: name, title, slots: picked }).catch((e) => console.warn('kizuna: could not remember the invite', e));
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

