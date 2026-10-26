// Pure audio helpers: resample to 16 kHz, convert to PCM16, cut into chunks, build WAV files.
// No browser APIs here, so everything is unit-testable in node.

export const TARGET_RATE = 16000;
/** 100 ms of 16 kHz mono PCM16. */
export const CHUNK_BYTES = 3200;

/**
 * Streaming downsampler. Each output sample is the average of the input it covers
 * (a box filter), which doubles as a simple low-pass so 44.1/48 kHz speech does not alias.
 * Upsampling (rare, e.g. an 8 kHz headset) falls back to holding the nearest sample.
 */
export class Resampler {
	readonly ratio: number; // input samples per output sample
	private buf = new Float32Array(0);
	private bufStart = 0; // global index of buf[0]
	private outIndex = 0;

	constructor(
		readonly inRate: number,
		readonly outRate = TARGET_RATE
	) {
		if (!(inRate > 0) || !(outRate > 0)) throw new Error('bad sample rate');
		this.ratio = inRate / outRate;
	}

	push(input: Float32Array): Float32Array {
		const buf = new Float32Array(this.buf.length + input.length);
		buf.set(this.buf);
		buf.set(input, this.buf.length);
		const end = this.bufStart + buf.length; // global index just past the last sample
		const r = this.ratio;
		const out: number[] = [];

		for (;;) {
			const t0 = this.outIndex * r;
			const t1 = t0 + r;
			const need = Math.ceil(t1 - 1e-7); // tolerate float error at whole-sample edges
			if (need > end) break;
			if (r <= 1) {
				out.push(buf[Math.floor(t0) - this.bufStart]);
			} else {
				let sum = 0;
				const first = Math.floor(t0);
				const last = need - 1;
				for (let j = first; j <= last; j++) {
					const w = Math.min(j + 1, t1) - Math.max(j, t0);
					if (w > 0) sum += buf[j - this.bufStart] * w;
				}
				out.push(sum / r);
			}
			this.outIndex++;
		}

		// Keep what the next output sample still needs.
		const keepFrom = Math.min(Math.floor(this.outIndex * r), end);
		this.buf = buf.slice(keepFrom - this.bufStart);
		this.bufStart = keepFrom;
		return Float32Array.from(out);
	}
}

/** Float [-1, 1] to signed 16-bit, clamped. */
export function floatToPcm16(input: Float32Array): Int16Array {
	const out = new Int16Array(input.length);
	for (let i = 0; i < input.length; i++) {
		const s = Math.max(-1, Math.min(1, input[i] || 0));
		out[i] = s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff);
	}
	return out;
}

/** Root mean square of a block, 0..1. */
export function rms(input: Float32Array): number {
	if (input.length === 0) return 0;
	let sum = 0;
	for (let i = 0; i < input.length; i++) sum += input[i] * input[i];
	return Math.sqrt(sum / input.length);
}

/** RMS to a friendly 0..1 level for a mic ring (speech sits around 0.3 to 0.8). */
export function levelFromRms(value: number): number {
	return Math.max(0, Math.min(1, Math.sqrt(value) * 2));
}

/** Little-endian bytes for PCM16 samples, whatever the platform byte order. */
export function pcm16ToBytes(samples: Int16Array): Uint8Array {
	const bytes = new Uint8Array(samples.length * 2);
	const view = new DataView(bytes.buffer);
	for (let i = 0; i < samples.length; i++) view.setInt16(i * 2, samples[i], true);
	return bytes;
}

/** Collects PCM16 samples and hands back fixed-size little-endian byte chunks. */
export class PcmChunker {
	private pending = new Int16Array(0);

	constructor(readonly chunkBytes = CHUNK_BYTES) {
		if (chunkBytes <= 0 || chunkBytes % 2) throw new Error('chunk size must be a positive even number');
	}

	push(samples: Int16Array): Uint8Array[] {
		const all = concatInt16([this.pending, samples]);
		const per = this.chunkBytes / 2;
		const chunks: Uint8Array[] = [];
		let i = 0;
		for (; i + per <= all.length; i += per) chunks.push(pcm16ToBytes(all.subarray(i, i + per)));
		this.pending = all.slice(i);
		return chunks;
	}

	/** Whatever is left, as one short chunk (or null). */
	flush(): Uint8Array | null {
		if (this.pending.length === 0) return null;
		const last = pcm16ToBytes(this.pending);
		this.pending = new Int16Array(0);
		return last;
	}
}

export function concatInt16(parts: Int16Array[]): Int16Array {
	let n = 0;
	for (const p of parts) n += p.length;
	const out = new Int16Array(n);
	let o = 0;
	for (const p of parts) {
		out.set(p, o);
		o += p.length;
	}
	return out;
}

/** Mono 16-bit PCM WAV file bytes (44-byte RIFF header + data). */
export function encodeWavBytes(samples: Int16Array, sampleRate: number): Uint8Array {
	const dataBytes = samples.length * 2;
	const bytes = new Uint8Array(44 + dataBytes);
	const v = new DataView(bytes.buffer);
	const str = (at: number, s: string) => {
		for (let i = 0; i < s.length; i++) v.setUint8(at + i, s.charCodeAt(i));
	};
	str(0, 'RIFF');
	v.setUint32(4, 36 + dataBytes, true);
	str(8, 'WAVE');
	str(12, 'fmt ');
	v.setUint32(16, 16, true); // fmt chunk size
	v.setUint16(20, 1, true); // PCM
	v.setUint16(22, 1, true); // mono
	v.setUint32(24, sampleRate, true);
	v.setUint32(28, sampleRate * 2, true); // byte rate
	v.setUint16(32, 2, true); // block align
	v.setUint16(34, 16, true); // bits per sample
	str(36, 'data');
	v.setUint32(40, dataBytes, true);
	bytes.set(pcm16ToBytes(samples), 44);
	return bytes;
}

export function encodeWav(samples: Int16Array, sampleRate: number): Blob {
	return new Blob([encodeWavBytes(samples, sampleRate) as Uint8Array<ArrayBuffer>], { type: 'audio/wav' });
}

/** Duration in ms of PCM16 mono bytes at a rate. */
export function bytesToMs(bytes: number, sampleRate = TARGET_RATE): number {
	return (bytes / 2 / sampleRate) * 1000;
}
