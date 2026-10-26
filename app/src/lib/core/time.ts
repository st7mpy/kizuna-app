// Find us a time: slots from free hours (+ busy times from a private iCal link),
// pick-a-time invites, Google Calendar links and .ics files.
import type { IcalResponse, InviteResponse, PlanOutput, Settings, Slot, Window } from '@kizuna/shared';
import { freeSlots } from '@kizuna/shared';
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

/**
 * Plain local slot finder, used when the shared one is unavailable.
 * Walks free windows day by day and returns the first slot that fits in each window.
 */
export function localFreeSlots(q: {
	now: Date;
	freeHours: Window[];
	busy: Busy[];
	from: string;
	to: string;
	durationMinutes: number;
	excludeWeekdays?: number[];
}): Slot[] {
	const out: Slot[] = [];
	const dur = q.durationMinutes * 60_000;
	const busy = q.busy.map((b) => [new Date(b.start).getTime(), new Date(b.end).getTime()] as const);
	for (let day = q.from; day <= q.to; day = addDays(day, 1)) {
		const wd = weekdayOf(day);
		if (q.excludeWeekdays?.includes(wd)) continue;
		const windows = q.freeHours.filter((w) => w.day === wd).sort((a, b) => minutesOf(a.start) - minutesOf(b.start));
		for (const w of windows) {
			const winEnd = dayToDate(day, w.end).getTime();
			let t = dayToDate(day, w.start).getTime();
			// not in the past; round up to the next half hour
			const soonest = Math.ceil((q.now.getTime() + 30 * 60_000) / 1_800_000) * 1_800_000;
			if (t < soonest) t = soonest;
			for (; t + dur <= winEnd; t += 1_800_000) {
				if (busy.some(([bs, be]) => t < be && t + dur > bs)) continue;
				const start = new Date(t);
				const end = new Date(t + dur);
				out.push({ start: isoWithOffset(start), end: isoWithOffset(end), label: slotLabel(start, end) });
				break;
			}
		}
	}
	return out;
}

/** Free slots via the shared slot maths, falling back to the local finder. */
export function findFreeSlots(q: {
	now: Date;
	timeZone: string;
	freeHours: Window[];
	busy: Busy[];
	from: string;
	to: string;
	durationMinutes: number;
}): Slot[] {
	try {
		const r = freeSlots({ ...q, now: isoWithOffset(q.now) });
		if (Array.isArray(r)) return r;
	} catch {
		/* shared slot maths not available: use the local one */
	}
	return localFreeSlots(q);
}

/** Two slots on different days when possible. */
export function pickTwo(slots: Slot[]): Slot[] {
	const first = slots[0];
	if (!first) return [];
	const day = (s: Slot) => s.start.slice(0, 10);
	const second = slots.find((s) => day(s) !== day(first)) ?? slots[1];
	return second ? [first, second] : [first];
}

/** Two slots for a person, from free hours + busy times, optionally a plain-language request. */
export async function suggestSlots(request = ''): Promise<{ slots: Slot[]; note: string | null }> {
	const s = await readSettings();
	const timeZone = s.timeZone || deviceTimeZone();
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
	const slots = pickTwo(
		findFreeSlots({ now, timeZone, freeHours: s.freeHours, busy, from: today, to: addDays(today, 14), durationMinutes: 60 })
	);
	const note = request.trim() ? 'Picked from your usual free hours.' : null;
	return { slots, note: slots.length ? note : 'No free hours in the next two weeks. You can change them in Settings.' };
}

/** Creates a pick-a-time page and returns its URL. */
export async function createInvite(personId: string, slots: Slot[]): Promise<string> {
	const s = await readSettings();
	// The page shows only the sender's first name; personId is kept for the call site's own use.
	void personId;
	const myName = (s.myName || '').trim().split(/\s+/)[0] || 'a friend';
	const r = await relayJson<InviteResponse>('/api/invite', {
		body: { fromName: myName, title: `Catch up with ${myName}`, slots: slots.slice(0, 3), timeZone: s.timeZone || deviceTimeZone() },
		timeoutMs: 15_000
	});
	if (/^https?:\/\//.test(r.url)) return r.url;
	const base = s.relayUrl?.replace(/\/+$/, '') || (typeof location !== 'undefined' ? location.origin : '');
	return base + (r.url.startsWith('/') ? r.url : `/${r.url}`);
}

/** 'YYYYMMDDTHHMMSSZ' */
export function utcStamp(d: Date | string): string {
	return new Date(d).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

export function googleCalendarLink(slot: Slot, title: string): string {
	const p = new URLSearchParams({ action: 'TEMPLATE', text: title, dates: `${utcStamp(slot.start)}/${utcStamp(slot.end)}` });
	return `https://calendar.google.com/calendar/render?${p.toString()}`;
}

function icsEscape(s: string): string {
	return s.replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

/** Folds lines longer than 75 octets (RFC 5545). */
function fold(line: string): string {
	const enc = new TextEncoder();
	if (enc.encode(line).length <= 75) return line;
	const parts: string[] = [];
	let cur = '';
	for (const ch of line) {
		if (enc.encode(cur + ch).length > (parts.length ? 74 : 75)) {
			parts.push(cur);
			cur = '';
		}
		cur += ch;
	}
	parts.push(cur);
	return parts.join('\r\n ');
}

export function icsText(slot: Slot, title: string, uid: string = crypto.randomUUID()): string {
	const lines = [
		'BEGIN:VCALENDAR',
		'VERSION:2.0',
		'PRODID:-//Kizuna//Kizuna//EN',
		'CALSCALE:GREGORIAN',
		'METHOD:PUBLISH',
		'BEGIN:VEVENT',
		`UID:${uid}@kizuna`,
		`DTSTAMP:${utcStamp(new Date())}`,
		`DTSTART:${utcStamp(slot.start)}`,
		`DTEND:${utcStamp(slot.end)}`,
		`SUMMARY:${icsEscape(title)}`,
		'END:VEVENT',
		'END:VCALENDAR'
	];
	return lines.map(fold).join('\r\n') + '\r\n';
}

export function icsFile(slot: Slot, title: string): Blob {
	return new Blob([icsText(slot, title)], { type: 'text/calendar;charset=utf-8' });
}

/** The user's next free window within [from, to] (for nudges). */
export function nextFreeWindow(s: Settings, now: Date, from: string, to: string, busy: Busy[] = []): Slot | null {
	const slots = findFreeSlots({
		now,
		timeZone: s.timeZone || deviceTimeZone(),
		freeHours: s.freeHours,
		busy,
		from,
		to,
		durationMinutes: 60
	});
	return slots.find((x) => new Date(x.start).getTime() > now.getTime()) ?? null;
}

