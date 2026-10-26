// WS /api/asr: the app streams PCM here; the relay adds the key and talks to the
// realtime ASR upstream, passing back partial and final transcripts.
import type { AsrServerMessage } from '@kizuna/shared';
import { metaBase, type Env } from './env.ts';
import { fail } from './http.ts';
import { limits } from './ratelimit.ts';
import { handshakeFrame, mapUpstreamEvent, stopFrame, upstreamUrl } from './asr-upstream.ts';

export const SESSION_CAP_MS = 10 * 60_000;
// The client waits up to 3 s after stop, so close a little before that.
const STOP_GRACE_MS = 2_500;
const AFTER_FINAL_MS = 700;
const MAX_PENDING_BYTES = 24_000 * 2 * 5; // about 5 s of audio while upstream connects

function languagesFrom(list: unknown, query: string | null): string[] {
	const raw = Array.isArray(list) ? list : (query ?? '').split(',');
	return raw
		.filter((x): x is string => typeof x === 'string')
		.map((x) => x.trim().toLowerCase())
		.filter((x) => /^[a-z]{2,3}(-[a-z0-9]{2,8})?$/.test(x))
		.slice(0, 5);
}

function trySetArrayBuffer(ws: WebSocket): void {
	try {
		(ws as { binaryType: string }).binaryType = 'arraybuffer';
	} catch {
		/* older runtimes only deliver ArrayBuffer */
	}
}

async function toArrayBuffer(data: unknown): Promise<ArrayBuffer | null> {
	if (data instanceof ArrayBuffer) return data;
	if (ArrayBuffer.isView(data)) return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
	if (data instanceof Blob) return data.arrayBuffer();
	return null;
}

export async function handleAsr(req: Request, env: Env): Promise<Response> {
	if (req.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
		return new Response('Expected a WebSocket', { status: 426 });
	}
	if (!limits.voice.allow(req)) return fail('rate_limited');
	const queryLang = new URL(req.url).searchParams.get('lang');

	const pair = new WebSocketPair();
	const [client, server] = Object.values(pair) as [WebSocket, WebSocket];
	server.accept();
	// Newer compatibility dates default to Blob; ask for ArrayBuffer.
	trySetArrayBuffer(server);

	let upstream: WebSocket | null = null;
	let started = false;
	let stopping = false;
	let done = false;
	let pending: ArrayBuffer[] = [];
	let pendingBytes = 0;
	let audioChain: Promise<void> = Promise.resolve();
	const timers: ReturnType<typeof setTimeout>[] = [];

	const send = (m: AsrServerMessage) => {
		try {
			server.send(JSON.stringify(m));
		} catch {
			/* client gone */
		}
	};
	const finish = (error?: string) => {
		if (done) return;
		done = true;
		for (const t of timers) clearTimeout(t);
		if (error) send({ type: 'error', error });
		send({ type: 'closed' });
		try {
			upstream?.close(1000, 'done');
		} catch {}
		try {
			server.close(1000, 'done');
		} catch {}
	};
	timers.push(setTimeout(() => finish('session_limit'), SESSION_CAP_MS));

	const connect = async (sampleRate: 16000 | 24000, languageBias: string[]) => {
		let res: Response;
		try {
			res = await fetch(upstreamUrl(metaBase(env)), { headers: { upgrade: 'websocket' } });
		} catch {
			return finish('upstream_unavailable');
		}
		const ws = res.webSocket;
		if (!ws) return finish('upstream_unavailable');
		ws.accept();
		trySetArrayBuffer(ws);
		if (done) return ws.close(1000, 'done');
		upstream = ws;
		ws.send(handshakeFrame({ apiKey: env.MODEL_API_KEY ?? '', sampleRate, languageBias }));
		for (const chunk of pending) ws.send(chunk);
		pending = [];
		pendingBytes = 0;
		if (stopping) ws.send(stopFrame());
		ws.addEventListener('message', (ev) => {
			if (typeof ev.data !== 'string') return;
			const m = mapUpstreamEvent(ev.data);
			if (!m) return;
			if (m.type === 'error') return finish('asr_error');
			send(m);
			if (m.type === 'final' && stopping) timers.push(setTimeout(() => finish(), AFTER_FINAL_MS));
		});
		ws.addEventListener('close', () => finish());
		ws.addEventListener('error', () => finish('asr_error'));
	};

	server.addEventListener('message', (ev) => {
		if (done) return;
		if (typeof ev.data === 'string') {
			let m: any;
			try {
				m = JSON.parse(ev.data);
			} catch {
				return;
			}
			if (m?.type === 'start' && !started) {
				started = true;
				const rate = m.sampleRate === 24000 ? 24000 : 16000;
				void connect(rate, languagesFrom(m.languageBias, queryLang));
			} else if (m?.type === 'stop' && !stopping) {
				stopping = true;
				if (!started) return finish();
				void audioChain.then(() => {
					try {
						upstream?.send(stopFrame());
					} catch {}
				});
				timers.push(setTimeout(() => finish(), STOP_GRACE_MS));
			}
			return;
		}
		if (!started || stopping) return;
		// Keep frame order even when a frame needs an async Blob read.
		audioChain = audioChain.then(async () => {
			const chunk = await toArrayBuffer(ev.data);
			if (!chunk || done) return;
			if (upstream) {
				try {
					upstream.send(chunk);
				} catch {
					finish('asr_error');
				}
			} else if (pendingBytes + chunk.byteLength <= MAX_PENDING_BYTES) {
				pending.push(chunk);
				pendingBytes += chunk.byteLength;
			}
		});
	});
	server.addEventListener('close', () => finish());
	server.addEventListener('error', () => finish());

	return new Response(null, { status: 101, webSocket: client });
}
