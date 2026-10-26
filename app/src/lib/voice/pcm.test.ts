import { describe, expect, it } from 'vitest';
import {
	bytesToMs,
	CHUNK_BYTES,
	concatInt16,
	encodeWav,
	encodeWavBytes,
	floatToPcm16,
	levelFromRms,
	PcmChunker,
	pcm16ToBytes,
	Resampler,
	rms
} from './pcm.ts';

function sine(freq: number, rate: number, seconds: number, amp = 0.5): Float32Array {
	const n = Math.round(rate * seconds);
	const out = new Float32Array(n);
	for (let i = 0; i < n; i++) out[i] = amp * Math.sin((2 * Math.PI * freq * i) / rate);
	return out;
}

describe('Resampler', () => {
	it('turns 48 kHz into 16 kHz (3:1) by averaging', () => {
		const r = new Resampler(48000);
		const out = r.push(Float32Array.from([0, 0.3, 0.6, 0.9, 0.9, 0.9]));
		expect(out.length).toBe(2);
		expect(out[0]).toBeCloseTo(0.3, 6);
		expect(out[1]).toBeCloseTo(0.9, 6);
	});

	it('gives the right count for 1 s of 44.1 kHz, however it is split', () => {
		const input = sine(440, 44100, 1);
		const whole = new Resampler(44100).push(input);
		const r = new Resampler(44100);
		const parts: Float32Array[] = [];
		for (let i = 0; i < input.length; i += 128) parts.push(r.push(input.subarray(i, i + 128)));
		const total = parts.reduce((n, p) => n + p.length, 0);
		expect(whole.length).toBe(16000);
		expect(total).toBe(16000);
		// Streaming in 128-sample frames matches one big push.
		const joined = new Float32Array(total);
		let o = 0;
		for (const p of parts) {
			joined.set(p, o);
			o += p.length;
		}
		for (let i = 0; i < total; i += 997) expect(joined[i]).toBeCloseTo(whole[i], 6);
	});

	it('keeps a constant level', () => {
		const out = new Resampler(44100).push(new Float32Array(4410).fill(0.25));
		expect(out.length).toBe(1600);
		for (const v of out) expect(v).toBeCloseTo(0.25, 6);
	});

	it('keeps speech-band tones and damps tones above the new Nyquist', () => {
		const low = new Resampler(48000).push(sine(300, 48000, 0.5));
		const high = new Resampler(48000).push(sine(15000, 48000, 0.5));
		expect(rms(low)).toBeGreaterThan(0.33); // ~0.354 for amp 0.5
		expect(rms(high)).toBeLessThan(0.1);
	});

	it('passes 16 kHz through unchanged and holds samples when upsampling', () => {
		const same = Float32Array.from([0.1, -0.2, 0.3]);
		expect(Array.from(new Resampler(16000).push(same))).toEqual(Array.from(same));
		const up = new Resampler(8000).push(Float32Array.from([0.5, -0.5]));
		expect(Array.from(up)).toEqual([0.5, 0.5, -0.5, -0.5]);
	});

	it('rejects bad rates', () => {
		expect(() => new Resampler(0)).toThrow();
	});
});

describe('floatToPcm16', () => {
	it('scales and clamps', () => {
		const out = floatToPcm16(Float32Array.from([0, 1, -1, 2, -2, 0.5, NaN]));
		expect(Array.from(out)).toEqual([0, 32767, -32768, 32767, -32768, 16384, 0]);
	});
});

describe('rms and level', () => {
	it('measures', () => {
		expect(rms(new Float32Array(0))).toBe(0);
		expect(rms(new Float32Array(10).fill(0.5))).toBeCloseTo(0.5);
		expect(levelFromRms(0)).toBe(0);
		expect(levelFromRms(1)).toBe(1);
		expect(levelFromRms(0.04)).toBeCloseTo(0.4);
	});
});

describe('pcm16ToBytes', () => {
	it('writes little-endian', () => {
		expect(Array.from(pcm16ToBytes(Int16Array.from([1, -2, 0x1234])))).toEqual([1, 0, 0xfe, 0xff, 0x34, 0x12]);
	});
});

describe('PcmChunker', () => {
	it('emits 3200-byte (100 ms) chunks and keeps the rest', () => {
		const c = new PcmChunker();
		expect(c.push(new Int16Array(1000))).toEqual([]);
		const chunks = c.push(new Int16Array(2500)); // 3500 samples total
		expect(chunks.length).toBe(2);
		expect(chunks.every((x) => x.byteLength === CHUNK_BYTES)).toBe(true);
		expect(bytesToMs(chunks[0].byteLength)).toBe(100);
		const tail = c.flush();
		expect(tail?.byteLength).toBe(300 * 2);
		expect(c.flush()).toBeNull();
	});

	it('keeps sample order across chunks', () => {
		const c = new PcmChunker(4);
		const out = [...c.push(Int16Array.from([1, 2, 3])), ...c.push(Int16Array.from([4, 5]))];
		const tail = c.flush()!;
		const all = [...out, tail].flatMap((b) => Array.from(new Int16Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength))));
		expect(all).toEqual([1, 2, 3, 4, 5]);
	});

	it('rejects odd sizes', () => {
		expect(() => new PcmChunker(3)).toThrow();
	});
});

describe('WAV', () => {
	it('writes a valid mono 16-bit header and data', () => {
		const samples = Int16Array.from([0, 1000, -1000, 32767]);
		const b = encodeWavBytes(samples, 16000);
		const v = new DataView(b.buffer);
		const s = (at: number, n: number) => String.fromCharCode(...b.subarray(at, at + n));
		expect(b.byteLength).toBe(44 + 8);
		expect(s(0, 4)).toBe('RIFF');
		expect(v.getUint32(4, true)).toBe(36 + 8);
		expect(s(8, 4)).toBe('WAVE');
		expect(s(12, 4)).toBe('fmt ');
		expect(v.getUint32(16, true)).toBe(16);
		expect(v.getUint16(20, true)).toBe(1);
		expect(v.getUint16(22, true)).toBe(1);
		expect(v.getUint32(24, true)).toBe(16000);
		expect(v.getUint32(28, true)).toBe(32000);
		expect(v.getUint16(32, true)).toBe(2);
		expect(v.getUint16(34, true)).toBe(16);
		expect(s(36, 4)).toBe('data');
		expect(v.getUint32(40, true)).toBe(8);
		expect([1, 2, 3].map((i) => v.getInt16(44 + i * 2, true))).toEqual([1000, -1000, 32767]);
	});

	it('returns an audio/wav Blob', async () => {
		const blob = encodeWav(new Int16Array(16000), 16000);
		expect(blob.type).toBe('audio/wav');
		expect(blob.size).toBe(44 + 32000);
	});

	it('concatInt16 joins parts', () => {
		expect(Array.from(concatInt16([Int16Array.from([1]), new Int16Array(0), Int16Array.from([2, 3])]))).toEqual([1, 2, 3]);
	});
});
