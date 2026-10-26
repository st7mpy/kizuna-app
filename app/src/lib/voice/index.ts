// Voice capture. Owner: voice. UI imports only from here.
//
// startListening(h) must be called straight from the tap handler (iOS needs the gesture to
// start audio). It resolves once the mic is live, or rejects with a plain message the UI can
// show (permission refused, no mic). Live words come through onPartial/onFinal. If streaming
// is not available, h.onMode('recording') fires and the text arrives only when stop() resolves
// (after a short 'transcribing' step). stop() always resolves; transcription trouble is
// reported through onError and the best text so far is returned.
import { captureSupported, startMicCapture } from './capture.ts';
import { deviceId } from '../core/relay.ts';
import { createListener, type ListenHandlers, type Listener, type ListenOptions, type SocketLike, type VoiceDeps } from './session.ts';

export type { ListenHandlers, Listener, ListenOptions, VoiceMode } from './session.ts';
export { encodeWav } from './pcm.ts';
export { transcribeBlob } from './transcribe.ts';

/** Starts the mic and streams to the relay; falls back to record-then-transcribe if streaming fails. */
export async function startListening(h: ListenHandlers, opts: ListenOptions = {}): Promise<Listener> {
	if (!opts.deps?.startCapture && !voiceSupported())
		throw new Error('Voice is not available in this browser. You can type instead.');
	return createListener(h, { ...browserDeps(), ...opts.deps }, opts);
}

export function voiceSupported(): boolean {
	return captureSupported();
}

function browserDeps(): VoiceDeps {
	return {
		startCapture: startMicCapture,
		openSocket: (url) => new WebSocket(url) as unknown as SocketLike,
		fetch: (...args) => fetch(...args),
		origin: typeof location !== 'undefined' ? location.origin : '',
		now: () => performance.now(),
		deviceId,
		onPageHide(fn) {
			if (typeof window === 'undefined') return () => {};
			const onVis = () => {
				if (document.visibilityState === 'hidden') fn();
			};
			window.addEventListener('pagehide', fn);
			document.addEventListener('visibilitychange', onVis);
			return () => {
				window.removeEventListener('pagehide', fn);
				document.removeEventListener('visibilitychange', onVis);
			};
		},
		async languageBias() {
			// Settings live in core; a slow or unfinished store must never hold up the mic.
			const core = await import('../core/index.ts');
			const s = await Promise.race([
				core.getSettings(),
				new Promise<never>((_, reject) => setTimeout(() => reject(new Error('slow')), 500))
			]);
			return s.languageBias;
		}
	};
}
