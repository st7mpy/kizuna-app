// The listener state machine. Browser pieces (mic, socket, fetch, clock, page events) come in
// through VoiceDeps so the whole flow can be tested in node with fakes.
//
// Flow:
//   connecting -> live        socket opened within OPEN_TIMEOUT_MS; PCM streams, words arrive
//   connecting -> recording   socket slow or failed; audio is kept and sent as a WAV on stop
//   live       -> recording   socket error/close mid-session; the WHOLE recording is transcribed
//                             on stop (streamed words so far stay on screen until then)
// Audio is always kept locally (16 kHz PCM16, ~1.9 MB per minute) so nothing is lost.
import type { AsrServerMessage } from '@kizuna/shared';
import type { CaptureFactory } from './capture.ts';
import {
	bytesToMs,
	concatInt16,
	encodeWav,
	floatToPcm16,
	levelFromRms,
	PcmChunker,
	Resampler,
	TARGET_RATE
} from './pcm.ts';
import { transcribeBlob } from './transcribe.ts';

export const OPEN_TIMEOUT_MS = 2500;
export const STOP_WAIT_MS = 3000;
export const MAX_SESSION_MS = 10 * 60 * 1000;
/** How far ahead of real time we may send (the upstream API rejects more than 5 s). */
export const MAX_AHEAD_MS = 3000;
/** If live streaming produced nothing, retry as a file when at least this much audio exists. */
export const RETRY_MIN_MS = 1000;
export const DEFAULT_LANGUAGE_BIAS = ['en', 'hi'];

export type VoiceMode = 'connecting' | 'live' | 'recording' | 'transcribing' | 'done';

export interface ListenHandlers {
	onPartial(text: string): void; // live words for the current turn
	onFinal(text: string): void; // a finished turn
	onError(message: string): void; // something the user should know; capture may continue
	onLevel?(level: number): void; // 0..1 mic level for the button animation
	/** Optional: where the session is. 'recording' means no live words, text comes after stop. */
	onMode?(mode: VoiceMode): void;
	/** Optional: the session ended by itself (10 minute cap or page hidden) or by stop(). */
	onStopped?(text: string): void;
}

export interface Listener {
	stop(): Promise<string>; // resolves with the full text heard
}

export interface SocketLike {
	readonly readyState: number;
	binaryType: string;
	onopen: ((ev: unknown) => void) | null;
	onmessage: ((ev: { data: unknown }) => void) | null;
	onerror: ((ev: unknown) => void) | null;
	onclose: ((ev: unknown) => void) | null;
	send(data: string | ArrayBuffer): void;
	close(code?: number, reason?: string): void;
}

export interface VoiceDeps {
	startCapture: CaptureFactory;
	openSocket(url: string): SocketLike;
	fetch: typeof fetch;
	origin: string;
	now(): number;
	/** Subscribes to "the page is going away"; returns an unsubscribe. */
	onPageHide(fn: () => void): () => void;
	/** Language hint; defaults to the user's settings, else en + hi. */
	languageBias(): Promise<string[]>;
	/** Per-install id for the relay's per-phone voice limit (sockets can't carry headers). */
	deviceId?(): string;
}

export interface ListenOptions {
	languageBias?: string[];
	deps?: Partial<VoiceDeps>;
}

const OPEN = 1;

export async function createListener(h: ListenHandlers, deps: VoiceDeps, opts: ListenOptions = {}): Promise<Listener> {
	// Start the mic first and synchronously (iOS needs the user gesture for the AudioContext).
	let finishing: Promise<string> | undefined;
	let captureOpen = true;
	const resampler = { current: undefined as Resampler | undefined };
	const chunker = new PcmChunker();
	const recorded: Int16Array[] = [];
	let recordedSamples = 0;
	const queue: Uint8Array[] = [];
	let mode: VoiceMode = 'connecting';
	const finals: string[] = [];
	let lastPartial = '';
	let sentMs = 0;
	let liveT0 = 0;
	let pumpTimer: ReturnType<typeof setTimeout> | undefined;
	let openTimer: ReturnType<typeof setTimeout> | undefined;
	let closedWaiter: (() => void) | undefined;
	let ws: SocketLike | undefined;
	let languageBias: string[] = DEFAULT_LANGUAGE_BIAS;
	let unhook = () => {};

	const capture = deps.startCapture((frames, level) => {
		if (!captureOpen || !resampler.current) return;
		h.onLevel?.(levelFromRms(level));
		const pcm = floatToPcm16(resampler.current.push(frames));
		if (pcm.length === 0) return;
		recorded.push(pcm);
		recordedSamples += pcm.length;
		for (const c of chunker.push(pcm)) queue.push(c);
		pump();
		if (recordedSamples >= (MAX_SESSION_MS / 1000) * TARGET_RATE) void finish();
	});
	resampler.current = new Resampler(capture.sampleRate, TARGET_RATE);

	const biasP = opts.languageBias?.length
		? Promise.resolve(opts.languageBias)
		: deps.languageBias().then(
				(b) => (b?.length ? b : DEFAULT_LANGUAGE_BIAS),
				() => DEFAULT_LANGUAGE_BIAS
			);

	try {
		await capture.ready;
	} catch (e) {
		captureOpen = false;
		await capture.stop().catch(() => {});
		throw new Error(micMessage(e));
	}
	languageBias = await biasP;
	if (finishing) return { stop: finish };

	function setMode(m: VoiceMode) {
		if (mode === m) return;
		mode = m;
		h.onMode?.(m);
	}
	h.onMode?.(mode);

	// One session id for the socket and its WAV fallback, so the relay charges one voice try.
	const ids: { device?: string; session?: string } = deps.deviceId ? { device: deps.deviceId(), session: crypto.randomUUID() } : {};
	const query = new URLSearchParams({ lang: languageBias.join(','), ...(ids as Record<string, string>) }).toString();
	const wsUrl = `${deps.origin.replace(/^http/, 'ws')}/api/asr?${query}`;
	try {
		ws = deps.openSocket(wsUrl);
		ws.binaryType = 'arraybuffer';
	} catch {
		ws = undefined;
	}

	openTimer = setTimeout(() => {
		if (mode === 'connecting') toRecording();
	}, OPEN_TIMEOUT_MS);

	function dropSocket() {
		if (!ws) return;
		const s = ws;
		ws = undefined;
		s.onopen = s.onmessage = s.onerror = s.onclose = null;
		try {
			s.close();
		} catch {
			/* ignore */
		}
	}

	function toRecording() {
		if (mode === 'recording' || mode === 'transcribing' || mode === 'done') return;
		clearTimeout(openTimer);
		clearTimeout(pumpTimer);
		dropSocket();
		queue.length = 0;
		setMode('recording');
		closedWaiter?.();
	}

	function pump() {
		clearTimeout(pumpTimer);
		pumpTimer = undefined;
		if (mode !== 'live' || !ws || ws.readyState !== OPEN) return;
		while (queue.length) {
			const ahead = sentMs - (deps.now() - liveT0);
			if (ahead > MAX_AHEAD_MS) {
				pumpTimer = setTimeout(pump, ahead - MAX_AHEAD_MS + 20);
				return;
			}
			const chunk = queue.shift()!;
			ws.send(chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength) as ArrayBuffer);
			sentMs += bytesToMs(chunk.byteLength);
		}
	}

	if (ws) {
		ws.onopen = () => {
			if (mode !== 'connecting' || !ws) return;
			clearTimeout(openTimer);
			ws.send(JSON.stringify({ type: 'start', sampleRate: TARGET_RATE, languageBias }));
			liveT0 = deps.now();
			setMode('live');
			pump();
		};
		ws.onmessage = (ev) => {
			if (typeof ev.data !== 'string') return;
			let msg: AsrServerMessage;
			try {
				msg = JSON.parse(ev.data);
			} catch {
				return;
			}
			if (msg.type === 'partial') {
				lastPartial = msg.text;
				h.onPartial(msg.text);
			} else if (msg.type === 'final') {
				const t = msg.text.trim();
				if (t) {
					finals.push(t);
					h.onFinal(t);
				}
				lastPartial = '';
			} else if (msg.type === 'error') {
				toRecording();
			} else if (msg.type === 'closed') {
				closedWaiter?.();
			}
		};
		ws.onerror = () => toRecording();
		ws.onclose = () => {
			if (closedWaiter) closedWaiter();
			else toRecording();
		};
	} else {
		toRecording();
	}

	unhook = deps.onPageHide(() => void finish());

	function streamedText() {
		return finals.length ? finals.join(' ') : lastPartial.trim();
	}

	async function transcribeRecording(): Promise<string> {
		const samples = concatInt16(recorded);
		if (samples.length === 0) return '';
		setMode('transcribing');
		return transcribeBlob(encodeWav(samples, TARGET_RATE), { origin: deps.origin, languageBias, fetch: deps.fetch, ...ids });
	}

	function finish(): Promise<string> {
		if (finishing) return finishing;
		finishing = (async () => {
			unhook();
			clearTimeout(openTimer);
			await capture.stop().catch(() => {}); // may deliver the last frames
			captureOpen = false;
			const tail = chunker.flush();
			if (tail) queue.push(tail);

			if (mode === 'connecting') toRecording();

			let text = '';
			if (mode === 'live' && ws) {
				// Send the rest now: it is at most a few seconds ahead, under the upstream limit.
				clearTimeout(pumpTimer);
				while (queue.length && ws.readyState === OPEN) {
					const c = queue.shift()!;
					ws.send(c.buffer.slice(c.byteOffset, c.byteOffset + c.byteLength) as ArrayBuffer);
				}
				await new Promise<void>((resolve) => {
					const t = setTimeout(resolve, STOP_WAIT_MS);
					closedWaiter = () => {
						clearTimeout(t);
						resolve();
					};
					try {
						ws!.send(JSON.stringify({ type: 'stop' }));
					} catch {
						resolve();
					}
				});
				closedWaiter = undefined;
				if (mode === 'live') {
					dropSocket();
					text = streamedText();
					if (!text && recordedSamples >= (RETRY_MIN_MS / 1000) * TARGET_RATE) toRecording();
				}
			}

			if (mode === 'recording') {
				try {
					text = await transcribeRecording();
				} catch {
					text = streamedText();
					h.onError(
						text
							? 'Some words may be missing. You can fix them before saving.'
							: 'Could not turn that into words just now. You can type it instead.'
					);
				}
			}
			dropSocket();
			setMode('done');
			h.onStopped?.(text);
			return text;
		})();
		return finishing;
	}

	return { stop: finish };
}

function micMessage(e: unknown): string {
	const name = (e as { name?: string } | null)?.name;
	if (name === 'NotAllowedError' || name === 'SecurityError')
		return 'Kizuna needs the microphone to listen. You can allow it in your browser settings, or type instead.';
	if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'No microphone found. You can type instead.';
	if (name === 'NotReadableError') return 'The microphone is busy with another app. You can type instead.';
	return 'Could not start the microphone. You can type instead.';
}
