import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handshakeFrame, languageNames, mapUpstreamEvent, readAck, safeCode, stopFrame, upstreamUrl } from '../src/asr-upstream.ts';
import { fakeAsrSession } from '../../tools/fake-meta/asr.ts';
import { transcriptFrom } from '../src/transcribe.ts';
import { route } from '../src/index.ts';
import { resetAllLimits } from '../src/ratelimit.ts';
import { makeEnv } from './helpers.ts';

describe('asr upstream adapter', () => {
	it('builds the documented handshake: bearer token in the frame, PCM encoding, language names', () => {
		const h = JSON.parse(handshakeFrame({ apiKey: 'k', sampleRate: 16000, languageBias: ['en', 'hi', 'xx'] }));
		expect(h).toEqual({
			authorization: { accessToken: 'Bearer k' },
			model: 'muse-voice-transcribe-1.0',
			mode: 'ENDPOINTING',
			audioEncoding: 'PCM_16KHZ',
			partialMode: 'CUMULATIVE',
			emitAudioProgress: false,
			languageBias: ['English', 'Hindi']
		});
		expect(JSON.parse(handshakeFrame({ apiKey: 'k', sampleRate: 24000, languageBias: [] }))).not.toHaveProperty('languageBias');
		expect(JSON.parse(handshakeFrame({ apiKey: 'k', sampleRate: 24000, languageBias: [] })).audioEncoding).toBe('PCM_24KHZ');
		expect(JSON.parse(stopFrame())).toEqual({ type: 'endStream' });
		expect(upstreamUrl('https://api.meta.ai/v1/', 'kizuna-1')).toBe('https://api.meta.ai/v1/asr/realtime?sessionId=kizuna-1');
	});

	it('maps language codes to names once each', () => {
		expect(languageNames(['hi-IN', 'hi', 'zh', 'fil'])).toEqual(['Hindi', 'Mandarin Chinese', 'Tagalog']);
	});

	it('reads the handshake ack', () => {
		expect(readAck('{"sessionId":"abc"}')).toEqual({ ok: true, sessionId: 'abc' });
		expect(readAck('{"type":"speechStart","turnId":1}')).toEqual({ ok: true, sessionId: '' });
		const bad = readAck('{"type":"error","code":"UNAUTHENTICATED","message":"bad key"}');
		expect(bad).toMatchObject({ ok: false, code: 'unauthenticated' });
		expect(!bad.ok && bad.detail).toBe('type=error code=unauthenticated message="bad key"');
		expect(readAck('{"message":"Invalid token"}')).toMatchObject({ ok: false, code: 'rejected' });
		expect(readAck('nope')).toMatchObject({ ok: false, code: 'bad_ack' });
	});

	it.each([
		[{ type: 'transcript', transcript: 'Mum ka', final: false }, { type: 'partial', text: 'Mum ka' }],
		[{ type: 'transcript', transcript: 'Mum ka knee', final: true }, { type: 'partial', text: 'Mum ka knee' }],
		[{ type: 'speechComplete', turnId: 1, transcript: 'done here ' }, { type: 'final', text: 'done here' }],
		[{ type: 'speechStart', turnId: 1 }, null],
		[{ type: 'speechEnd', turnId: 1 }, null],
		[{ type: 'audioProgress' }, null],
		[{ type: 'transcript', transcript: '   ' }, null],
		[{ sessionId: 'abc' }, null]
	])('maps %j', (input, out) => {
		expect(mapUpstreamEvent(JSON.stringify(input))).toEqual(out);
	});

	it('turns an error frame into a short code and a diagnostic without transcript text', () => {
		expect(mapUpstreamEvent('{"type":"error","code":"rate limited","message":"slow down"}')).toEqual({
			type: 'upstream_error',
			code: 'rate_limited',
			detail: 'type=error code=rate_limited message="slow down"'
		});
		expect(mapUpstreamEvent('{"error":{"code":429,"message":"x"}}')).toMatchObject({ type: 'upstream_error', code: '429' });
		expect(safeCode('Bad Token!!')).toBe('bad_token');
		expect(safeCode('')).toBe('unknown');
	});

	it('ignores non-JSON', () => {
		expect(mapUpstreamEvent('hello')).toBeNull();
	});
});

describe('fake realtime ASR speaks the same protocol as the adapter', () => {
	function run(frames: (string | number)[]) {
		const sent: string[] = [];
		const closes: [number, string][] = [];
		const timers: (() => void)[] = [];
		const s = fakeAsrSession(
			{ send: (t) => sent.push(t), close: (c, r) => closes.push([c, r]) },
			{ setTimer: (fn) => timers.push(fn), clearTimer: () => {} }
		);
		for (const f of frames) typeof f === 'number' ? s.binary(f) : s.text(f);
		return { sent, closes, timers };
	}

	it('acks the handshake, streams partials and ends the turn on endStream', () => {
		const { sent, closes } = run([handshakeFrame({ apiKey: 'k', sampleRate: 16000, languageBias: ['en'] }), 32000, 32000, stopFrame()]);
		expect(readAck(sent[0])).toMatchObject({ ok: true });
		const mapped = sent.slice(1).map(mapUpstreamEvent).filter(Boolean);
		expect(mapped[0]).toMatchObject({ type: 'partial' });
		expect(mapped.at(-1)).toMatchObject({ type: 'final' });
		expect((mapped.at(-1) as { text: string }).text.length).toBeGreaterThan(10);
		expect(closes).toEqual([[1000, 'done']]);
	});

	it('rejects the old guessed handshake, which the adapter reports as a code', () => {
		const { sent, closes } = run([JSON.stringify({ type: 'session.start', token: 'k', sampleRate: 16000 })]);
		expect(readAck(sent[0])).toMatchObject({ ok: false, code: 'unauthorized' });
		expect(closes[0][0]).toBe(4001);
	});
});

describe('transcribe response shapes', () => {
	it.each([
		['{"text":"Kabir ne naya job"}', 'application/json', 'Kabir ne naya job'],
		['{"transcript":"a b"}', 'application/json', 'a b'],
		['{"results":[{"text":"one"},{"text":"two"}]}', 'application/json', 'one two'],
		['{"result":{"segments":[{"text":"x"},{"text":"y"}]}}', 'application/json', 'x y'],
		['data: {"type":"partial","text":"Mum"}\n\ndata: {"type":"final","text":"Mum ka"}\n', 'text/event-stream', 'Mum ka'],
		['plain words\n', 'text/plain', 'plain words']
	])('reads %s', (body, ct, text) => {
		expect(transcriptFrom(body, ct)).toBe(text);
	});
});

function wav(bytes = 64): Uint8Array {
	const b = new Uint8Array(bytes);
	b.set(new TextEncoder().encode('RIFF'), 0);
	b.set(new TextEncoder().encode('WAVE'), 8);
	return b;
}

describe('POST /api/transcribe', () => {
	let fetchMock: ReturnType<typeof vi.fn>;
	beforeEach(() => {
		resetAllLimits();
		fetchMock = vi.fn();
		vi.stubGlobal('fetch', fetchMock);
	});
	afterEach(() => vi.unstubAllGlobals());

	it('sends multipart with request JSON and audio, returns text', async () => {
		fetchMock.mockResolvedValueOnce(new Response('{"text":"hello"}', { headers: { 'content-type': 'application/json' } }));
		const req = new Request('https://kizuna.test/api/transcribe?lang=en,hi', { method: 'POST', body: wav(), headers: { 'content-type': 'audio/wav' } });
		const res = await route(req, makeEnv());
		expect(await res.json()).toEqual({ ok: true, text: 'hello' });
		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toMatch(/^https:\/\/meta\.test\/v1\/asr\/transcribe\?sessionId=[0-9a-f-]{36}$/);
		expect(init.headers.accept).toBe('application/json');
		expect(init.headers.authorization).toBe('Bearer test-key');
		const form = init.body as FormData;
		expect(JSON.parse(form.get('request') as string)).toEqual({ mode: 'ENDPOINTING', model: 'muse-voice-transcribe-1.0', audioEncoding: 'WAV', languageBias: ['en', 'hi'] });
		expect((form.get('audio') as unknown as File).size).toBe(64);
	});

	it('rejects non-WAV bodies', async () => {
		const req = new Request('https://kizuna.test/api/transcribe', { method: 'POST', body: 'not audio at all, just text that is long enough' });
		expect((await route(req, makeEnv())).status).toBe(400);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('maps upstream failure', async () => {
		fetchMock.mockResolvedValueOnce(new Response('x', { status: 500 }));
		const req = new Request('https://kizuna.test/api/transcribe', { method: 'POST', body: wav() });
		expect(await (await route(req, makeEnv())).json()).toMatchObject({ ok: false, error: 'model_error' });
	});

	it('asks for a WebSocket upgrade on /api/asr', async () => {
		expect((await route(new Request('https://kizuna.test/api/asr'), makeEnv())).status).toBe(426);
	});
});
