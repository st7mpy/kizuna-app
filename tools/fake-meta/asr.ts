// Fake realtime ASR session, following the upstream protocol (see relay/src/asr-upstream.ts):
// handshake frame with authorization.accessToken -> ack {sessionId}; binary PCM16 frames ->
// speechStart, cumulative `transcript` partials, speechEnd, speechComplete; {"type":"endStream"} ends it.
import { CANNED_SENTENCE } from './fake.ts';

export interface AsrPeer {
	send(text: string): void;
	close(code: number, reason: string): void;
}

export interface FakeAsrOptions {
	/** No audio for this long ends the turn. */
	silenceMs?: number;
	setTimer?: (fn: () => void, ms: number) => unknown;
	clearTimer?: (t: unknown) => void;
	log?: (...parts: unknown[]) => void;
}

const WORDS = CANNED_SENTENCE.split(' ');

export function fakeAsrSession(peer: AsrPeer, o: FakeAsrOptions = {}) {
	const setTimer = o.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
	const clearTimer = o.clearTimer ?? ((t) => clearTimeout(t as ReturnType<typeof setTimeout>));
	const log = o.log ?? (() => {});
	let ready = false;
	let closed = false;
	let sampleRate = 16000;
	let bytes = 0;
	let shown = 0;
	let turn = 0;
	let inTurn = false;
	let silence: unknown = null;

	const json = (m: unknown) => !closed && peer.send(JSON.stringify(m));
	const close = (code: number, reason: string) => {
		if (closed) return;
		closed = true;
		if (silence) clearTimer(silence);
		peer.close(code, reason);
	};
	const completeTurn = () => {
		if (!inTurn) return;
		inTurn = false;
		json({ type: 'speechEnd', turnId: turn });
		json({ type: 'speechComplete', turnId: turn, transcript: CANNED_SENTENCE });
		log('asr final', `${(bytes / (sampleRate * 2)).toFixed(1)} s audio`);
	};

	return {
		text(raw: string) {
			if (closed) return;
			let m: any = {};
			try {
				m = JSON.parse(raw);
			} catch {}
			if (!ready) {
				const token = m?.authorization?.accessToken;
				if (typeof token !== 'string' || !/^Bearer \S+/.test(token)) {
					json({ type: 'error', code: 'unauthorized', message: 'handshake needs authorization.accessToken' });
					return close(4001, 'unauthorized');
				}
				if (m.audioEncoding !== 'PCM_16KHZ' && m.audioEncoding !== 'PCM_24KHZ') {
					json({ type: 'error', code: 'invalid_request', message: 'audioEncoding must be PCM_16KHZ or PCM_24KHZ' });
					return close(4000, 'invalid_request');
				}
				ready = true;
				sampleRate = m.audioEncoding === 'PCM_24KHZ' ? 24000 : 16000;
				json({ sessionId: `fake-${Math.random().toString(36).slice(2, 10)}` });
				log('asr start', sampleRate);
				return;
			}
			if (m?.type === 'endStream') {
				if (bytes > 0) completeTurn();
				close(1000, 'done');
			}
		},
		binary(length: number) {
			if (closed) return;
			if (!ready) {
				json({ type: 'error', code: 'invalid_request', message: 'audio before handshake' });
				return close(4000, 'invalid_request');
			}
			if (!inTurn) {
				inTurn = true;
				turn++;
				shown = 0;
				json({ type: 'speechStart', turnId: turn });
			}
			bytes += length;
			const want = Math.min(WORDS.length, Math.floor((bytes / (sampleRate * 2)) * 2.5));
			if (want > shown) {
				shown = want;
				json({ type: 'transcript', transcript: WORDS.slice(0, shown).join(' '), final: false });
			}
			if (silence) clearTimer(silence);
			silence = setTimer(completeTurn, o.silenceMs ?? 2000);
		},
		close() {
			closed = true;
			if (silence) clearTimer(silence);
		}
	};
}
