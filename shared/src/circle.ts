// Kizuna map: a small shared circle (family + close friends) that shows who is open to a call.
// Contract between the app, the relay and the family page (/c/:id).
//
// Privacy model
// - A circle is an id plus a 256-bit AES-GCM key. The key only lives on devices and in the
//   URL fragment (#k=...), which browsers never send to the server. The relay stores ciphertext only.
// - Each member writes exactly one entry: KV key `circle:<id>:m:<memberId>`, TTL 8 days.
//   One key per member means no write conflicts. No history is kept.
// - Shared: chosen name, time zone, a coarse status that expires within 12 h, up to 3 windows
//   in the next 7 days. Never: location, calendar titles, notes, gift hints, room level.
// - "Not today" and "paused" look exactly like "nothing shared".
import type { Language, Slot } from './types.ts';

/** Coarse, expiring status. There is deliberately no "busy" and no "offline". */
export type CircleStatus = 'free' | 'maybe';

/** A free window, absolute times with offset (ISO). */
export interface CircleWindow {
	start: string;
	end: string;
}

/** Plain member entry, encrypted before it leaves a device. */
export interface CircleEntry {
	v: 1;
	name: string; // the name this member chose, <= 40 chars
	tz: string; // IANA time zone
	status: CircleStatus | null;
	statusUntil: string | null; // ISO; status is ignored after this (max now + 12 h)
	windows: CircleWindow[]; // <= 3, all within the next 7 days
	notThisWeekend?: boolean; // said "not this weekend" (shown to others as nothing)
	quietStart?: string; // 'HH:MM' local, default 22:00
	quietEnd?: string; // 'HH:MM' local, default 08:00
	via: 'app' | 'page'; // written by the Kizuna app or by the family page
	updatedAt: string; // ISO
}

/** Ciphertext as stored by the relay. Both fields base64url (no padding). iv is 12 bytes. */
export interface Sealed {
	iv: string;
	ct: string;
}

export const CIRCLE_LIMITS = {
	maxMembers: 12,
	maxSealedBytes: 4096, // ct length after base64url decode
	entryTtlSeconds: 8 * 24 * 3600,
	circleTtlSeconds: 90 * 24 * 3600, // the circle record itself; refreshed on every write
	statusMaxHours: 12,
	maxWindows: 3
} as const;

/** Ids: circle id 16 chars, member id 12 chars, both [A-Za-z0-9_-]. */
export const CIRCLE_ID_RE = /^[A-Za-z0-9_-]{16}$/;
export const MEMBER_ID_RE = /^[A-Za-z0-9_-]{12}$/;

// ---------- routes ----------
// POST   /api/circle                    body {}                  -> CreateCircleResponse
// PUT    /api/circle/:id/m/:memberId    body Sealed              -> { ok: true }
// DELETE /api/circle/:id/m/:memberId                             -> { ok: true }   (leave)
// GET    /api/circle/:id                                         -> CircleState
// GET    /c/:id                         family page (HTML, no app needed); key read from #k=
// Errors use the usual { ok: false, error } shape: not_found, bad_request, too_large, rate_limited.
export interface CreateCircleResponse {
	ok: true;
	id: string;
	/** Page URL without the key; the app appends `#k=<key>` itself. */
	url: string;
}
export interface CircleState {
	ok: true;
	id: string;
	members: ({ memberId: string } & Sealed)[];
}

/** Family-page link: `${origin}/c/${id}#k=${keyB64url}` (plus optional `&from=<first name>`). */
export function circleLink(origin: string, id: string, key: string, fromName?: string): string {
	const from = fromName ? `&from=${encodeURIComponent(fromName.slice(0, 40))}` : '';
	return `${origin.replace(/\/$/, '')}/c/${id}#k=${key}${from}`;
}

// ---------- occasions ----------
export type OccasionKind = 'festival' | 'birthday' | 'anniversary' | 'other';
export interface Occasion {
	day: string; // 'YYYY-MM-DD'
	name: string; // "Thanksgiving", "Dad's birthday"
	kind: OccasionKind;
	personIds: string[]; // empty for a festival that applies to everyone
	region?: string; // e.g. 'US' for days kept mainly in the US
}

// ---------- gift hints (stored on the phone only, never shared) ----------
export interface GiftHint {
	id: string;
	personId: string;
	what: string; // "a brighter reading lamp"
	fragmentId: string;
	createdAt: string;
	status: 'open' | 'done' | 'dropped';
}

// ---------- Spark task: windows (a free-text reply -> windows) ----------
/** "Sunday shaam ko free hoon", "Sat after lunch, not before 2" -> windows. */
export interface WindowsInput {
	reply: string; // <= 500 chars
	now: string; // ISO with offset, in the replier's zone
	timeZone: string;
}
export interface WindowsOutput {
	windows: { day: string; start: string; end: string }[]; // 'YYYY-MM-DD', 'HH:MM', 'HH:MM' local; <= 3
	not_this_weekend: boolean;
	language: Language;
}

// ---------- Spark task: weekend (tool loop over the map) ----------
// The app sends everything the tools need; the relay is stateless and runs the tools itself
// from this input, so notes never sit on the server. Tools:
//   get_windows(person_ids[], from, to)   -> each person's windows (in their zone and yours)
//   get_occasions(from, to)               -> occasions in range
//   get_local_time(person_id, at)         -> 'HH:MM' + weekday in their zone, and whether it is quiet hours
//   get_reasons(person_id)                -> short reason lines from the user's own notes (sensitive removed)
//   finish(...)                           -> the plan (shape = WeekendOutput)
export interface WeekendPerson {
	id: string;
	name: string;
	relation: string;
	timeZone: string;
	language: Language;
	windows: CircleWindow[];
	quietStart: string;
	quietEnd: string;
}
export interface WeekendInput {
	request: string; // "" for the default weekend plan, or "not Sunday, Dad has a game"
	now: string; // ISO with offset
	timeZone: string; // user's zone
	me: { name: string; windows: CircleWindow[]; quietStart: string; quietEnd: string };
	people: WeekendPerson[]; // <= 8
	occasions: Occasion[]; // next 14 days
	reasons: { personId: string; text: string }[]; // <= 3 per person, sensitive details already removed
	minMinutes: number; // default 45
}
export interface WeekendOutput {
	slot: Slot | null; // null = nothing good this weekend (a valid answer)
	personIds: string[]; // who is free in that slot (>= 2 people including the user)
	skipped: { personId: string; why: string; alt: Slot | null }[]; // e.g. Kabir asleep, alt Saturday 20:00
	reason: string; // one kind line: "It's Thanksgiving morning."
	occasion: string | null; // occasion name if the plan is built around one
	tools_used: string[]; // tool names in call order, for the trace in the UI
}

/** The card the app shows (built from WeekendOutput, not stored). */
export interface WeekendCard {
	kind: 'weekend';
	slot: Slot;
	personIds: string[];
	skipped: WeekendOutput['skipped'];
	reason: string;
	occasion: string | null;
	trace: string[];
}

/** The gift card on Today / the map (built on the phone, not stored). */
export interface GiftCard {
	kind: 'gift';
	personId: string;
	occasion: Occasion;
	daysLeft: number;
	hint: GiftHint;
	withPersonId: string | null; // a sibling to plan it with
}
