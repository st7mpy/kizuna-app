// Contract between the app and the relay. The relay only runs these tasks:
// the app never sends free-form prompts, so the API key can't be used as a general proxy.

import type { EventKind, Language, Relation, Slot, ThreadKind, Window } from './types.ts';
import type { WeekendInput, WeekendOutput, WindowsInput, WindowsOutput } from './circle.ts';

export const SPARK_MODEL = 'muse-spark-1.3';
export const ASR_MODEL = 'muse-voice-transcribe-1.0';
export const META_BASE_URL = 'https://api.meta.ai/v1';

export type TaskName = 'extract' | 'weave' | 'draft' | 'plan' | 'rank' | 'windows' | 'weekend';

// ---------- extract: one note -> people, events, promises, threads ----------
export interface ExtractInput {
	text: string;
	today: string; // 'YYYY-MM-DD' local
	weekday: string; // 'Monday'
	knownPeople: { name: string; aliases: string[]; relation: Relation }[];
}
export interface ExtractOutput {
	language: Language;
	sensitive: boolean; // health, money, conflict mentioned
	people: { name: string; relation: Relation }[];
	events: {
		what: string;
		kind: EventKind;
		people: string[]; // names as in `people`
		date: string | null; // model's 'YYYY-MM-DD' guess, checked by the date guard
		time: string | null; // 'HH:MM'
		date_text: string | null; // exact words used for the date
	}[];
	promises: { what: string; person: string | null; date_text: string | null }[];
	threads: { title: string; kind: ThreadKind; people: string[] }[];
	/** Things someone would like ("Papa wants a brighter reading lamp"). Never prices or money. */
	gift_hints: { person: string; what: string }[];
}

// ---------- weave: everything so far -> circle, merged names, threads ----------
export interface WeaveInput {
	today: string;
	notes: { id: string; day: string; text: string }[];
	people: { id: string; name: string; aliases: string[]; relation: Relation; circle: string }[];
}
export interface WeaveOutput {
	people: {
		id: string | null; // existing person id, or null for someone new
		name: string;
		aliases: string[];
		merge_ids: string[]; // other existing ids that are the same person
		relation: Relation;
		closeness: 'inner' | 'close' | 'around';
		suggest_circle: boolean;
		why: string; // one short sentence
		summary: string; // what's going on with them now, <= 80 chars
	}[];
	threads: { title: string; kind: ThreadKind; people: string[]; note_ids: string[]; status: 'open' | 'done' }[];
}

// ---------- draft: a poke line ----------
export interface DraftInput {
	personName: string;
	relation: Relation;
	reason: string; // why now, in plain words
	context: string[]; // a few recent things about them (sensitive details already removed)
	myRecentLines: string[]; // how the user writes, for tone
	language: Language;
	withTime?: string; // optional slot label to offer
}
export interface DraftOutput {
	line: string; // <= 200 chars, no guilt, no fake urgency
	language: Language;
}

// ---------- plan: natural language -> slots (tool calling inside the relay) ----------
export interface PlanInput {
	request: string; // "sometime next weekend, not Sunday" or "" for default
	now: string; // ISO with offset
	timeZone: string; // IANA, e.g. 'Asia/Kolkata'
	freeHours: Window[];
	busy: { start: string; end: string }[]; // next 21 days, from the iCal link
	durationMinutes: number; // default 60
}
export interface PlanOutput {
	slots: Slot[]; // up to 2, best first
	note: string | null; // e.g. "Nothing free on Saturday; Friday evening instead."
}

// ---------- rank: order candidate cards when there are more than fit ----------
export interface RankInput {
	room: 'low' | 'some' | 'lots';
	candidates: { id: string; title: string; reason: string }[];
}
export interface RankOutput {
	order: string[]; // candidate ids, best first
}

export interface TaskIO {
	extract: { input: ExtractInput; output: ExtractOutput };
	weave: { input: WeaveInput; output: WeaveOutput };
	draft: { input: DraftInput; output: DraftOutput };
	plan: { input: PlanInput; output: PlanOutput };
	rank: { input: RankInput; output: RankOutput };
	windows: { input: WindowsInput; output: WindowsOutput };
	weekend: { input: WeekendInput; output: WeekendOutput };
}

/** POST /api/spark body */
export interface SparkRequest<T extends TaskName = TaskName> {
	task: T;
	input: TaskIO[T]['input'];
}
/** POST /api/spark response */
export type SparkResponse<T extends TaskName = TaskName> =
	| { ok: true; output: TaskIO[T]['output']; usage?: { input_tokens: number; output_tokens: number } }
	| { ok: false; error: 'bad_request' | 'rate_limited' | 'model_error' | 'invalid_output' | 'too_large'; detail?: string };

// ---------- invites (pick-a-time page) ----------
/** POST /api/invite body */
export interface InviteRequest {
	fromName: string; // first name only
	title: string; // "Catch up with Aarav"
	slots: Slot[]; // 1 to 3
	timeZone: string;
}
export interface InviteResponse { ok: true; id: string; url: string }
/** GET /api/invite/:id -> the invite plus the pick, if made */
export interface InviteState extends InviteRequest { id: string; pickedIndex: number | null; expiresAt: string }
/** POST /api/invite/:id/pick body */
export interface PickRequest { index: number }

// ---------- calendar feed ----------
/** POST /api/ical body; returns busy times only */
export interface IcalRequest { url: string; from: string; to: string }
export interface IcalResponse { ok: true; busy: { start: string; end: string }[] }

// ---------- voice ----------
// WS /api/asr?lang=en,hi : client sends a JSON {type:'start', sampleRate:16000, languageBias:[...]} text frame,
// then binary PCM16 LE mono frames paced in real time, then {type:'stop'}.
// Server sends JSON text frames:
export type AsrServerMessage =
	| { type: 'partial'; text: string }
	| { type: 'final'; text: string } // one per finished turn
	| { type: 'error'; error: string }
	| { type: 'closed' };
// Fallback: POST /api/transcribe with a WAV body (audio/wav, mono 16-bit 16 kHz, <= 10 min) -> { ok: true, text }
export interface TranscribeResponse { ok: true; text: string }
