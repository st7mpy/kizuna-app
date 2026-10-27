// Adapter for the realtime ASR upstream (muse-voice-transcribe). Everything that
// depends on the wire format lives here, so a protocol change is a one-file fix.
//
// Protocol (wss://api.meta.ai/v1/asr/realtime?sessionId=<id>):
//   1. No auth header (it is ignored). The first text frame is the handshake:
//      { authorization: { accessToken: 'Bearer <key>' }, model, mode: 'ENDPOINTING',
//        audioEncoding: 'PCM_16KHZ' | 'PCM_24KHZ', partialMode: 'CUMULATIVE',
//        emitAudioProgress: false, languageBias?: ['English', 'Hindi'] }
//      languageBias takes English language names, not codes.
//   2. The server acks with JSON carrying `sessionId`. An ack without it is a rejection
//      (its `message` says why). Audio is sent only after the ack.
//   3. Audio: binary frames of raw PCM16 LE mono, paced near real time.
//   4. Events (text JSON, key `type`): speechStart, transcript {transcript, final}
//      (cumulative within the turn), speechEnd, speechComplete {turnId, transcript},
//      audioProgress, speaker, error {message}.
//   5. Client ends with the text frame {"type":"endStream"}.
import { ASR_MODEL, type AsrServerMessage } from '@kizuna/shared';

/** Upstream URL for a Workers fetch() upgrade (http/https scheme, same host as wss). */
export function upstreamUrl(base: string, sessionId: string): string {
	return `${base.replace(/\/+$/, '')}/asr/realtime?sessionId=${encodeURIComponent(sessionId)}`;
}

// The 25 supported languages, by code, as the names the API expects.
const LANGUAGE_NAMES: Record<string, string> = {
	ar: 'Arabic',
	bn: 'Bengali',
	nl: 'Dutch',
	en: 'English',
	fr: 'French',
	de: 'German',
	he: 'Hebrew',
	hi: 'Hindi',
	id: 'Indonesian',
	it: 'Italian',
	ja: 'Japanese',
	kn: 'Kannada',
	ko: 'Korean',
	ms: 'Malay',
	zh: 'Mandarin Chinese',
	mr: 'Marathi',
	pl: 'Polish',
	pt: 'Portuguese',
	es: 'Spanish',
	tl: 'Tagalog',
	fil: 'Tagalog',
	ta: 'Tamil',
	te: 'Telugu',
	th: 'Thai',
	tr: 'Turkish',
	vi: 'Vietnamese'
};

/** 'en', 'hi-IN' -> 'English', 'Hindi'. Unknown codes are dropped (the API then auto-detects). */
export function languageNames(codes: string[]): string[] {
	const out: string[] = [];
	for (const c of codes) {
		const name = LANGUAGE_NAMES[c.toLowerCase().split('-')[0]];
		if (name && !out.includes(name)) out.push(name);
	}
	return out;
}

export interface HandshakeOptions { apiKey: string; sampleRate: 16000 | 24000; languageBias: string[] }

/** First text frame sent upstream. */
export function handshakeFrame(o: HandshakeOptions): string {
	const names = languageNames(o.languageBias);
	return JSON.stringify({
		authorization: { accessToken: `Bearer ${o.apiKey}` },
		model: ASR_MODEL,
		mode: 'ENDPOINTING',
		audioEncoding: o.sampleRate === 24000 ? 'PCM_24KHZ' : 'PCM_16KHZ',
		partialMode: 'CUMULATIVE',
		emitAudioProgress: false,
		...(names.length ? { languageBias: names } : {})
	});
}

/** Frame that ends the stream; the server finishes the last turn and closes. */
export function stopFrame(): string {
	return JSON.stringify({ type: 'endStream' });
}

function parse(raw: string): Record<string, any> | null {
	try {
		const m = JSON.parse(raw);
		return m && typeof m === 'object' && !Array.isArray(m) ? m : null;
	} catch {
		return null;
	}
}

/** A short [a-z0-9_] code that is safe to log and to pass to the client. */
export function safeCode(v: unknown, fallback = 'unknown'): string {
	const s = String(v ?? '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '_')
		.replace(/^_+|_+$/g, '')
		.slice(0, 40);
	return s || fallback;
}

const EVENT_TYPES = new Set(['transcript', 'speechStart', 'speechEnd', 'speechComplete', 'audioProgress', 'speaker']);

export type AckResult = { ok: true; sessionId: string } | { ok: false; code: string; detail: string };

/**
 * Reads the server's first reply to the handshake. A reply with `sessionId` is a
 * success; a normal event also counts (the session is plainly running). Anything
 * else is a rejection. `detail` is a short diagnostic (type/code/message of the
 * error frame) that never contains transcript text.
 */
export function readAck(raw: string): AckResult {
	const m = parse(raw);
	if (!m) return { ok: false, code: 'bad_ack', detail: 'non-JSON reply' };
	if (typeof m.sessionId === 'string' && m.sessionId && m.type !== 'error') return { ok: true, sessionId: m.sessionId };
	if (typeof m.type === 'string' && EVENT_TYPES.has(m.type)) return { ok: true, sessionId: '' };
	return { ok: false, code: errorCode(m), detail: errorDetail(m) };
}

function errorCode(m: Record<string, any>): string {
	const e = typeof m.error === 'object' && m.error ? m.error : m;
	return safeCode(e.code ?? e.status ?? e.errorCode ?? (m.type === 'error' ? 'error' : 'rejected'), 'rejected');
}

/** type/code/message of an error frame, trimmed. Only called for frames without a transcript. */
export function errorDetail(m: Record<string, any>): string {
	const e = typeof m.error === 'object' && m.error ? m.error : m;
	const msg = typeof e.message === 'string' ? e.message : typeof m.error === 'string' ? m.error : '';
	return `type=${safeCode(m.type, '-')} code=${safeCode(e.code ?? e.status ?? e.errorCode, '-')} message=${JSON.stringify(msg.slice(0, 160))}`;
}

export type UpstreamEvent = AsrServerMessage | { type: 'upstream_error'; code: string; detail: string };

/**
 * Maps one upstream text frame to a client message, or null to ignore it.
 * Partials are cumulative within a turn; speechComplete closes the turn.
 */
export function mapUpstreamEvent(raw: string): UpstreamEvent | null {
	const m = parse(raw);
	if (!m) return null;
	const type = String(m.type ?? '');
	if (type === 'error' || (m.error && typeof m.transcript !== 'string')) {
		return { type: 'upstream_error', code: errorCode(m), detail: errorDetail(m) };
	}
	const text = typeof m.transcript === 'string' ? m.transcript : typeof m.text === 'string' ? m.text : null;
	if (type === 'speechComplete') return { type: 'final', text: (text ?? '').trim() };
	if (type === 'transcript' && text != null) {
		if (!text.trim()) return null;
		// In ENDPOINTING mode the turn ends with speechComplete; `final` here only marks a stable partial.
		return { type: 'partial', text: text.trim() };
	}
	return null;
}
