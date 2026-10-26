// Records stored on the phone (IndexedDB). Dates are ISO strings.
// A "day" is 'YYYY-MM-DD' in the user's local time zone; a "time" is 'HH:MM' 24h.

export type Source = 'voice' | 'typed' | 'sample';
export type Language = 'en' | 'hi' | 'mixed' | 'other';

export interface Fragment {
	id: string;
	text: string;
	createdAt: string; // ISO timestamp
	source: Source;
	language?: Language;
	/** 'new' = not yet understood, 'done' = extracted, 'failed' = gave up after retries */
	status: 'new' | 'done' | 'failed';
	tries: number;
	nextTryAt?: string; // ISO; not tried again before this (backoff after an error)
	sensitive?: boolean;
	personIds?: string[]; // people this note mentions (set once understood)
}

export type Relation =
	| 'parent' | 'sibling' | 'partner' | 'child' | 'family'
	| 'friend' | 'colleague' | 'other' | 'unknown';

export interface Person {
	id: string;
	name: string; // display name, e.g. "Mum", "Kabir"
	aliases: string[]; // lower-case names this person is called, e.g. ["ma","mummy","mum"]
	relation: Relation;
	phone?: string; // E.164 without '+', only if the user adds it
	/** 'suggested' = weave proposed it, 'in' = user kept, 'out' = user said not now */
	circle: 'none' | 'suggested' | 'in' | 'out';
	summary?: string; // short line, e.g. "New job since Monday"
	why?: string; // why weave suggested them
	mentions: number;
	lastMentionedAt?: string; // ISO
	lastReachedAt?: string; // ISO, when user poked or met them (never shown as a counter)
	createdAt: string;
}

export type EventKind = 'birthday' | 'appointment' | 'milestone' | 'plan' | 'trip' | 'other';

export interface KEvent {
	id: string;
	personIds: string[];
	what: string; // "knee appointment", "started new job"
	kind: EventKind;
	day: string | null; // resolved 'YYYY-MM-DD' after the date guard, null if unknown
	time: string | null; // 'HH:MM' or null
	dateText: string | null; // the words the user used: "Thursday", "kal"
	dateConfidence: 'sure' | 'guess' | 'none';
	fragmentId: string;
	createdAt: string;
}

export type ThreadKind = 'idea' | 'plan' | 'promise' | 'errand';

export interface Thread {
	id: string;
	title: string;
	kind: ThreadKind;
	personIds: string[];
	fragmentIds: string[];
	status: 'open' | 'done' | 'dropped';
	dueDay?: string | null;
	createdAt: string;
	updatedAt: string;
}

export type PromptAnswer = 'poke' | 'time' | 'not_now' | 'done';

export type ReasonKind =
	| 'event_soon' // an event of theirs is coming up or just happened
	| 'promise' // "should call Kabir"
	| 'gap' // a long quiet stretch with a circle person
	| 'thread' // one of the user's own open threads
	| 'suggest_circle'; // "Keep Kabir in your circle?" (not counted in the weekly cap)

/** A nudge shown on Today. Kept only to space nudges out; never shown as history. */
export interface Prompt {
	id: string;
	personId: string | null; // null for a thread card
	threadId: string | null;
	reason: ReasonKind;
	reasonText: string; // "Kabir started his new job on Monday."
	shownAt: string;
	answer?: PromptAnswer;
	answeredAt?: string;
}

export type Room = 'low' | 'some' | 'lots';

export interface Window {
	day: number; // 0 = Sunday ... 6 = Saturday
	start: string; // 'HH:MM'
	end: string; // 'HH:MM'
}

export interface Settings {
	id: 'me';
	myName: string; // first name used on the pick-a-time page
	freeHours: Window[]; // when the user is usually free for people
	quietStart: string; // 'HH:MM', no nudges after
	quietEnd: string; // 'HH:MM', no nudges before
	weeklyCap: number; // max people nudges per 7 days (default 5)
	icalUrl?: string; // optional private iCal link
	languageBias: string[]; // e.g. ['en','hi']
	room?: { day: string; level: Room }; // today's room tap
	relayUrl?: string; // override for dev
	timeZone?: string; // IANA, the phone's current zone (read from Intl each time, not stored)
	lastWeaveAt?: string;
	weaveFailedAt?: string; // last failed weave; no new try for 6 h after it
	notesSinceWeave: number;
}

/** A proposed meeting slot. */
export interface Slot {
	start: string; // ISO with offset
	end: string; // ISO with offset
	label: string; // "Sat 9 Nov, 10:00 to 11:00"
}

/** A card on Today, built by the nudge engine (not stored). */
export interface Card {
	promptId: string;
	kind: 'person' | 'thread' | 'suggest_circle';
	personId?: string;
	threadId?: string;
	title: string; // "Kabir"
	reason: string; // "Started his new job on Monday. You're both free Thursday evening."
	slot?: Slot;
	actions: ('poke' | 'time' | 'not_now' | 'keep' | 'done')[];
}
