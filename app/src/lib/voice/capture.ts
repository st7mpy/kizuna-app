// Browser mic capture: getUserMedia -> AudioContext -> AudioWorklet (or ScriptProcessor on
// older browsers). Hands mono float frames at the context's rate to a callback.
import workletUrl from './pcm-worklet.js?url&no-inline';
import { rms } from './pcm.ts';

export interface Capture {
	/** Rate of the frames passed to onAudio (the device/context rate, often 44100 or 48000). */
	readonly sampleRate: number;
	/** Resolves once the mic is live; rejects if permission is refused or no mic exists. */
	readonly ready: Promise<void>;
	/** Flushes the last frames, releases the mic and closes the context. Safe to call twice. */
	stop(): Promise<void>;
}

export type OnAudio = (samples: Float32Array, rms: number) => void;
export type CaptureFactory = (onAudio: OnAudio) => Capture;

type AudioContextCtor = typeof AudioContext;

function audioContextCtor(): AudioContextCtor | undefined {
	if (typeof window === 'undefined') return undefined;
	const w = window as unknown as { AudioContext?: AudioContextCtor; webkitAudioContext?: AudioContextCtor };
	return w.AudioContext ?? w.webkitAudioContext;
}

export function captureSupported(): boolean {
	return typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && !!audioContextCtor();
}

/**
 * Must be called synchronously inside the tap handler: iOS Safari only lets an
 * AudioContext start from a user gesture, so the context is created and resumed here
 * before anything awaits.
 */
export const startMicCapture: CaptureFactory = (onAudio) => {
	const Ctor = audioContextCtor();
	if (!Ctor || !navigator.mediaDevices?.getUserMedia) throw new Error('unsupported');
	const ctx = new Ctor();
	const resumed = ctx.resume().catch(() => {});

	let stream: MediaStream | undefined;
	let source: MediaStreamAudioSourceNode | undefined;
	let worklet: AudioWorkletNode | undefined;
	let processor: ScriptProcessorNode | undefined;
	let stopped = false;
	let stopping: Promise<void> | undefined;
	let workletDone: (() => void) | undefined;

	const release = () => {
		try {
			source?.disconnect();
			worklet?.disconnect();
			processor?.disconnect();
		} catch {
			/* already disconnected */
		}
		if (processor) processor.onaudioprocess = null;
		stream?.getTracks().forEach((t) => t.stop());
		if (ctx.state !== 'closed') ctx.close().catch(() => {});
	};

	const ready = (async () => {
		stream = await navigator.mediaDevices.getUserMedia({
			audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 }
		});
		if (stopped) {
			release();
			throw new Error('stopped');
		}
		await resumed;
		if (ctx.state === 'suspended') await ctx.resume().catch(() => {});
		source = ctx.createMediaStreamSource(stream);

		if (ctx.audioWorklet && typeof AudioWorkletNode !== 'undefined') {
			try {
				await ctx.audioWorklet.addModule(workletUrl);
				const node = new AudioWorkletNode(ctx, 'kizuna-pcm-tap', {
					numberOfInputs: 1,
					numberOfOutputs: 1,
					outputChannelCount: [1]
				});
				node.port.onmessage = (e: MessageEvent<{ samples?: Float32Array; rms?: number; done?: boolean }>) => {
					if (e.data.samples) onAudio(e.data.samples, e.data.rms ?? 0);
					if (e.data.done) workletDone?.();
				};
				source.connect(node);
				node.connect(ctx.destination); // output is silent; this keeps the graph pulling
				worklet = node;
			} catch {
				worklet = undefined;
			}
		}
		if (!worklet) {
			const sp = ctx.createScriptProcessor(4096, 1, 1);
			sp.onaudioprocess = (e) => {
				const data = new Float32Array(e.inputBuffer.getChannelData(0));
				onAudio(data, rms(data));
				e.outputBuffer.getChannelData(0).fill(0);
			};
			source.connect(sp);
			sp.connect(ctx.destination);
			processor = sp;
		}
	})();
	ready.catch(() => release());

	return {
		sampleRate: ctx.sampleRate,
		ready,
		stop() {
			if (stopping) return stopping;
			stopped = true;
			stopping = (async () => {
				if (worklet) {
					// Ask the worklet for its last partial block, but never wait long.
					await new Promise<void>((resolve) => {
						workletDone = resolve;
						setTimeout(resolve, 200);
						worklet!.port.postMessage('stop');
					});
				}
				release();
			})();
			return stopping;
		}
	};
};
