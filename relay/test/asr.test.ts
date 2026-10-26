import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handshakeFrame, mapUpstreamEvent, stopFrame, upstreamUrl } from '../src/asr-upstream.ts';
import { transcriptFrom } from '../src/transcribe.ts';
import { route } from '../src/index.ts';
import { resetAllLimits } from '../src/ratelimit.ts';
import { makeEnv } from './helpers.ts';

describe('asr upstream adapter', () => {
	it('builds the handshake with the key and audio format', () => {
		const h = JSON.parse(handshakeFrame({ apiKey: 'k', sampleRate: 16000, languageBias: ['en', 'hi'] }));
		expect(h).toMatchObject({ token: 'k', model: 'muse-voice-transcribe-1.0', sampleRate: 16000, encoding: 'PCM16', languageBias: ['en', 'hi'] });
		expect(JSON.parse(stopFrame()).type).toBeTruthy();
		expect(upstreamUrl('https://api.meta.ai/v1/')).toBe('https://api.meta.ai/v1/asr/realtime');
	});

	it.each([
		[{ type: 'partial', text: 'Mum ka' }, { type: 'partial', text: 'Mum ka' }],
		[{ type: 'transcript', transcript: 'Mum ka knee', isFinal: false }, { type: 'partial', text: 'Mum ka knee' }],
		[{ type: 'transcript', transcript: 'Mum ka knee', is_final: true }, { type: 'final', text: 'Mum ka knee' }],
		[{ type: 'speechComplete', text: 'done here ' }, { type: 'final', text: 'done here' }],
		[{ event: 'speech_complete', result: { text: 'ok' } }, { type: 'final', text: 'ok' }],
		[{ type: 'turn.completed', alternatives: [{ transcript: 'hi' }] }, { type: 'final', text: 'hi' }],
		[{ speechComplete: true, data: { transcript: 'x' } }, { type: 'final', text: 'x' }],
		[{ type: 'error', message: 'bad token' }, { type: 'error', error: 'asr_error' }],
		[{ type: 'session.started' }, null],
		[{ type: 'partial', text: '   ' }, null]
	])('maps %j', (input, out) => {
		expect(mapUpstreamEvent(JSON.stringify(input))).toEqual(out);
	});

	it('ignores non-JSON', () => {
		expect(mapUpstreamEvent('hello')).toBeNull();
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
