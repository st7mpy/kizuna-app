import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Capture, OnAudio } from './capture.ts';
import { createListener, type ListenHandlers, type SocketLike, type VoiceDeps, type VoiceMode } from './session.ts';
import { transcribeBlob } from './transcribe.ts';

class FakeSocket implements SocketLike {
	readyState = 0;
	binaryType = 'blob';
	onopen: SocketLike['onopen'] = null;
	onmessage: SocketLike['onmessage'] = null;
	onerror: SocketLike['onerror'] = null;
	onclose: SocketLike['onclose'] = null;
	sent: (string | ArrayBuffer)[] = [];
	closed = false;
	constructor(readonly url: string) {}
	send(d: string | ArrayBuffer) {
		this.sent.push(d);
	}
	close() {
		this.closed = true;
		this.readyState = 3;
	}
	open() {
		this.readyState = 1;
		this.onopen?.({});
	}
	say(msg: object) {
		this.onmessage?.({ data: JSON.stringify(msg) });
	}
	json() {
		return this.sent.filter((d): d is string => typeof d === 'string').map((d) => JSON.parse(d));
	}
	binaryBytes() {
		return this.sent.filter((d): d is ArrayBuffer => typeof d !== 'string').reduce((n, b) => n + b.byteLength, 0);
	}
}

function setup(over: Partial<VoiceDeps> = {}, captureOver: Partial<Capture> = {}) {
	let onAudio: OnAudio = () => {};
	const sockets: FakeSocket[] = [];
	const modes: VoiceMode[] = [];
	const h = {
		onPartial: vi.fn(),
		onFinal: vi.fn(),
		onError: vi.fn(),
		onLevel: vi.fn(),
		onMode: (m: VoiceMode) => modes.push(m),
		onStopped: vi.fn()
	} satisfies ListenHandlers;
	const captureStop = vi.fn(async () => {});
	let hide = () => {};
	const fetchMock = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
		new Response(JSON.stringify({ ok: true, text: 'from file' }), { status: 200 })
	);
	const deps: VoiceDeps = {
		startCapture: (cb) => {
			onAudio = cb;
			return { sampleRate: 48000, ready: Promise.resolve(), stop: captureStop, ...captureOver };
		},
		openSocket: (url) => {
			const s = new FakeSocket(url);
			sockets.push(s);
			return s;
		},
		fetch: fetchMock as unknown as typeof fetch,
		origin: 'https://kizuna.test',
		now: () => Date.now(),
		onPageHide: (fn) => {
			hide = fn;
			return () => {
				hide = () => {};
			};
		},
		languageBias: async () => ['en', 'hi'],
		...over
	};
	/** Feed `ms` of 48 kHz audio in 2048-sample blocks. */
	const speak = (ms: number) => {
		const total = Math.round((48000 * ms) / 1000);
		for (let i = 0; i < total; i += 2048) onAudio(new Float32Array(Math.min(2048, total - i)).fill(0.1), 0.1);
	};
	return { h, deps, sockets, modes, speak, fetchMock, captureStop, hidePage: () => hide() };
}

beforeEach(() => {
	vi.useFakeTimers();
});
afterEach(() => {
	vi.useRealTimers();
});

describe('listener: live streaming', () => {
	it('sends start, streams buffered audio after open, and joins finals', async () => {
		const t = setup();
		const listener = await createListener(t.h, t.deps);
		const ws = t.sockets[0];
		expect(ws.url).toBe('wss://kizuna.test/api/asr?lang=en%2Chi');
		expect(ws.binaryType).toBe('arraybuffer');

		t.speak(500); // while connecting: buffered, not sent
		expect(ws.sent.length).toBe(0);
		ws.open();
		expect(ws.json()[0]).toEqual({ type: 'start', sampleRate: 16000, languageBias: ['en', 'hi'] });
		expect(ws.binaryBytes()).toBe(16000); // 5 x 3200-byte chunks
		expect(t.modes).toEqual(['connecting', 'live']);

		ws.say({ type: 'partial', text: 'Mum ka knee' });
		ws.say({ type: 'final', text: 'Mum ka knee appointment Thursday hai' });
		ws.say({ type: 'partial', text: 'call Kabir' });
		ws.say({ type: 'final', text: 'call Kabir' });
		expect(t.h.onPartial).toHaveBeenCalledWith('Mum ka knee');
		expect(t.h.onFinal).toHaveBeenCalledTimes(2);
		expect(t.h.onLevel).toHaveBeenCalled();

		t.speak(50); // half a chunk, flushed on stop
		const done = listener.stop();
		await vi.advanceTimersByTimeAsync(0);
		expect(ws.json().at(-1)).toEqual({ type: 'stop' });
		expect(ws.binaryBytes()).toBe(16000 + 1600);
		ws.say({ type: 'closed' });
		await expect(done).resolves.toBe('Mum ka knee appointment Thursday hai call Kabir');
		expect(ws.closed).toBe(true);
		expect(t.captureStop).toHaveBeenCalled();
		expect(t.fetchMock).not.toHaveBeenCalled();
		expect(t.h.onStopped).toHaveBeenCalledWith('Mum ka knee appointment Thursday hai call Kabir');
		expect(t.modes.at(-1)).toBe('done');
	});

	it('uses the last partial when no final came, after waiting at most 3 s', async () => {
		const t = setup();
		const listener = await createListener(t.h, t.deps, { languageBias: ['hi'] });
		const ws = t.sockets[0];
		ws.open();
		expect(ws.json()[0].languageBias).toEqual(['hi']);
		t.speak(300);
		ws.say({ type: 'partial', text: 'Riya wants to do something' });
		const done = listener.stop();
		await vi.advanceTimersByTimeAsync(3000);
		await expect(done).resolves.toBe('Riya wants to do something');
	});

	it('does not send more than 3 s ahead of real time', async () => {
		const t = setup();
		await createListener(t.h, t.deps);
		const ws = t.sockets[0];
		t.speak(2000); // 2 s buffered: under the limit, so all goes at once on open
		ws.open();
		expect(ws.binaryBytes()).toBe(64000);
		t.speak(2000); // an unrealistic burst: 4 s sent in 0 s of wall time
		expect(ws.binaryBytes()).toBeLessThan(128000);
		await vi.advanceTimersByTimeAsync(1100);
		expect(ws.binaryBytes()).toBe(128000);
	});

	it('stop() is idempotent', async () => {
		const t = setup();
		const listener = await createListener(t.h, t.deps);
		t.sockets[0].open();
		const a = listener.stop();
		const b = listener.stop();
		expect(a).toBe(b);
		await vi.advanceTimersByTimeAsync(3000);
		await expect(a).resolves.toBe('');
	});
});

describe('listener: fallback to record-then-transcribe', () => {
	it('falls back when the socket does not open within 2.5 s', async () => {
		const t = setup();
		const listener = await createListener(t.h, t.deps);
		t.speak(1000);
		await vi.advanceTimersByTimeAsync(2500);
		expect(t.modes).toEqual(['connecting', 'recording']);
		expect(t.sockets[0].closed).toBe(true);
		t.speak(1000);
		const text = await listener.stop();
		expect(text).toBe('from file');
		expect(t.modes).toEqual(['connecting', 'recording', 'transcribing', 'done']);
		const [url, init] = t.fetchMock.mock.calls[0];
		expect(url).toBe('https://kizuna.test/api/transcribe?lang=en%2Chi');
		const body = init!.body as Blob;
		expect(body.type).toBe('audio/wav');
		expect(body.size).toBe(44 + 2 * 32000); // all 2 s kept, nothing dropped
	});

	it('falls back when the server errors, and transcribes the whole recording', async () => {
		const t = setup();
		const listener = await createListener(t.h, t.deps);
		const ws = t.sockets[0];
		ws.open();
		t.speak(1000);
		ws.say({ type: 'partial', text: 'hello' });
		ws.say({ type: 'error', error: 'upstream' });
		expect(t.modes.at(-1)).toBe('recording');
		t.speak(500);
		await expect(listener.stop()).resolves.toBe('from file');
		const body = t.fetchMock.mock.calls[0][1]!.body as Blob;
		expect(body.size).toBe(44 + 48000);
	});

	it('falls back on socket error before open', async () => {
		const t = setup();
		const listener = await createListener(t.h, t.deps);
		t.sockets[0].onerror?.({});
		expect(t.modes.at(-1)).toBe('recording');
		t.speak(200);
		await expect(listener.stop()).resolves.toBe('from file');
	});

	it('retries as a file when live streaming heard nothing', async () => {
		const t = setup();
		const listener = await createListener(t.h, t.deps);
		const ws = t.sockets[0];
		ws.open();
		t.speak(1500);
		const done = listener.stop();
		await vi.advanceTimersByTimeAsync(0);
		ws.say({ type: 'closed' });
		await expect(done).resolves.toBe('from file');
	});

	it('reports transcribe failure and resolves with what it has', async () => {
		const t = setup({
			fetch: (async () => new Response('nope', { status: 502 })) as unknown as typeof fetch
		});
		const listener = await createListener(t.h, t.deps);
		t.sockets[0].onclose?.({});
		t.speak(300);
		await expect(listener.stop()).resolves.toBe('');
		expect(t.h.onError).toHaveBeenCalledWith('Could not turn that into words just now. You can type it instead.');
	});
});

describe('listener: lifecycle', () => {
	it('rejects with a plain message when the mic is refused', async () => {
		const err = Object.assign(new Error('denied'), { name: 'NotAllowedError' });
		const ready = Promise.reject(err);
		ready.catch(() => {});
		const t = setup({}, { ready });
		await expect(createListener(t.h, t.deps)).rejects.toThrow(/needs the microphone/);
		expect(t.sockets.length).toBe(0);
		expect(t.captureStop).toHaveBeenCalled();
	});

	it('stops by itself when the page is hidden', async () => {
		const t = setup();
		await createListener(t.h, t.deps);
		const ws = t.sockets[0];
		ws.open();
		ws.say({ type: 'final', text: 'buy milk' });
		t.hidePage();
		await vi.advanceTimersByTimeAsync(0);
		ws.say({ type: 'closed' });
		await vi.advanceTimersByTimeAsync(0);
		expect(t.h.onStopped).toHaveBeenCalledWith('buy milk');
		expect(t.captureStop).toHaveBeenCalled();
	});

	it('caps a session at 10 minutes', async () => {
		const t = setup();
		await createListener(t.h, t.deps);
		const ws = t.sockets[0];
		ws.open();
		ws.say({ type: 'final', text: 'long one' });
		for (let i = 0; i < 600; i++) {
			t.speak(1000);
			await vi.advanceTimersByTimeAsync(1000);
		}
		await vi.advanceTimersByTimeAsync(3000);
		expect(t.captureStop).toHaveBeenCalled();
		expect(t.h.onStopped).toHaveBeenCalledWith('long one');
	});
});

describe('transcribeBlob', () => {
	it('posts the WAV and returns trimmed text', async () => {
		const f = vi.fn(async () => new Response(JSON.stringify({ ok: true, text: ' hi there ' })));
		const text = await transcribeBlob(new Blob(['x'], { type: 'audio/wav' }), { origin: 'https://k.test', fetch: f as unknown as typeof fetch });
		expect(text).toBe('hi there');
		expect(f).toHaveBeenCalledWith('https://k.test/api/transcribe', expect.objectContaining({ method: 'POST' }));
	});

	it('throws on a bad answer', async () => {
		const f = async () => new Response(JSON.stringify({ ok: false, error: 'too_large' }), { status: 413 });
		await expect(transcribeBlob(new Blob([]), { origin: '', fetch: f as unknown as typeof fetch })).rejects.toThrow(/too_large/);
	});
});
