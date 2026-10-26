// Adapter for the realtime ASR upstream (muse-voice-transcribe).
//
// NOTE: the handshake and event JSON below are a best guess. What is known: the
// endpoint is wss://.../v1/asr/realtime, auth goes in a first handshake frame
// (the Authorization header is ignored), audio is raw PCM16 LE mono at 16 or
// 24 kHz paced near real time, and the server sends partial transcripts plus a
// speechComplete event per turn. When testing against the real API, fix the
// three functions below; nothing else in the relay depends on the wire format.
import { ASR_MODEL, type AsrServerMessage } from '@kizuna/shared';

/** Upstream URL for a Workers fetch() upgrade (http/https scheme, same host as wss). */
export function upstreamUrl(base: string): string {
	return `${base.replace(/\/+$/, '')}/asr/realtime`;
}

export interface HandshakeOptions { apiKey: string; sampleRate: 16000 | 24000; languageBias: string[] }

/** First text frame sent upstream. */
export function handshakeFrame(o: HandshakeOptions): string {
	return JSON.stringify({
		type: 'session.start',
		token: o.apiKey,
		model: ASR_MODEL,
		sampleRate: o.sampleRate,
		encoding: 'PCM16',
		languageBias: o.languageBias
	});
}

/** Frame that asks upstream to finish the current turn and end the session. */
export function stopFrame(): string {
	return JSON.stringify({ type: 'session.stop' });
}

function pickText(m: any): string | null {
	const candidates = [
		m.text,
		m.transcript,
		m.result?.text,
		m.result?.transcript,
		m.data?.text,
		m.data?.transcript,
		m.alternatives?.[0]?.transcript,
		m.alternatives?.[0]?.text,
		Array.isArray(m.words) ? m.words.map((w: any) => w?.word ?? w?.text ?? '').join(' ') : undefined
	];
	for (const c of candidates) if (typeof c === 'string') return c;
	return null;
}

/**
 * Maps one upstream text frame to a client message, or null to ignore it.
 * Tolerant: accepts type names like partial/transcript/final/speechComplete and
 * flags like isFinal/is_final/final/speechComplete.
 */
export function mapUpstreamEvent(raw: string): AsrServerMessage | null {
	let m: any;
	try {
		m = JSON.parse(raw);
	} catch {
		return null;
	}
	if (!m || typeof m !== 'object') return null;
	const type = String(m.type ?? m.event ?? m.kind ?? '').toLowerCase();
	if (type.includes('error') || (m.error && !pickText(m))) {
		return { type: 'error', error: 'asr_error' };
	}
	const text = pickText(m);
	const final =
		m.isFinal === true ||
		m.is_final === true ||
		m.final === true ||
		m.speechComplete === true ||
		m.speech_complete === true ||
		/final|complete|completed|end_of_turn|endofturn/.test(type.replace(/[.\-]/g, '_'));
	if (text == null) return null;
	if (final) return { type: 'final', text: text.trim() };
	if (!text.trim()) return null;
	return { type: 'partial', text: text.trim() };
}
