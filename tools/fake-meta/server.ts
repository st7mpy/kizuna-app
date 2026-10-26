// Local fake of the Meta API, so Kizuna runs end to end without a key.
//   node --experimental-strip-types server.ts      (port 8788, or PORT)
// Routes: POST /v1/chat/completions, WS /v1/asr/realtime, POST /v1/asr/transcribe.
// Logs method, path, task and status only; never request contents.
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { WebSocketServer, type WebSocket, type RawData } from 'ws';
import { CANNED_SENTENCE, detectTask, fakeCompletion } from './fake.ts';

const PORT = Number(process.env.PORT ?? 8788);
const MAX_BODY = 40 * 1024 * 1024;

function log(...parts: unknown[]): void {
	console.log(new Date().toISOString().slice(11, 19), ...parts);
}

function readBody(req: IncomingMessage): Promise<Buffer> {
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = [];
		let size = 0;
		req.on('data', (c: Buffer) => {
			size += c.length;
			if (size > MAX_BODY) {
				reject(new Error('too large'));
				req.destroy();
			} else chunks.push(c);
		});
		req.on('end', () => resolve(Buffer.concat(chunks)));
		req.on('error', reject);
	});
}

function send(res: ServerResponse, status: number, body: unknown, type = 'application/json'): void {
	const text = typeof body === 'string' ? body : JSON.stringify(body);
	res.writeHead(status, { 'content-type': type });
	res.end(text);
}

function authorized(req: IncomingMessage): boolean {
	return /^Bearer \S+/.test(req.headers.authorization ?? '');
}

const server = createServer(async (req, res) => {
	const path = (req.url ?? '/').split('?')[0];
	try {
		if (req.method === 'GET' && path === '/v1/health') return send(res, 200, { ok: true });
		if (req.method === 'POST' && path === '/v1/chat/completions') {
			if (!authorized(req)) return send(res, 401, { error: { message: 'missing key' } });
			const body = JSON.parse((await readBody(req)).toString('utf8'));
			if (/contributor/.test(String(body.model))) return send(res, 400, { error: { message: 'model not allowed' } });
			// A short pause so loading states are visible in the app.
			await new Promise((r) => setTimeout(r, 250 + Math.random() * 400));
			const out = fakeCompletion(body);
			log('chat', detectTask(body) ?? '?', out.status);
			return send(res, out.status, out.json);
		}
		if (req.method === 'POST' && path === '/v1/asr/transcribe') {
			if (!authorized(req)) return send(res, 401, { error: { message: 'missing key' } });
			const audio = await readBody(req);
			log('transcribe', `${Math.round(audio.length / 1024)} KB`);
			await new Promise((r) => setTimeout(r, 500));
			if ((req.headers.accept ?? '').includes('text/plain')) return send(res, 200, CANNED_SENTENCE, 'text/plain');
			return send(res, 200, { text: CANNED_SENTENCE, language: 'hi-en' });
		}
		send(res, 404, { error: { message: 'not found' } });
	} catch {
		log(req.method, path, 'error');
		send(res, 400, { error: { message: 'bad request' } });
	}
});

// ---- realtime ASR: partial words as audio arrives, then a final per turn ----
const wss = new WebSocketServer({ noServer: true });
const WORDS = CANNED_SENTENCE.split(' ');

wss.on('connection', (ws: WebSocket) => {
	let ready = false;
	let sampleRate = 16000;
	let bytes = 0;
	let shown = 0;
	let silence: ReturnType<typeof setTimeout> | null = null;
	let finalSent = false;

	const sendFinal = () => {
		if (finalSent) return;
		finalSent = true;
		ws.send(JSON.stringify({ type: 'speechComplete', text: CANNED_SENTENCE, isFinal: true }));
		log('asr final', `${(bytes / (sampleRate * 2)).toFixed(1)} s audio`);
	};

	ws.on('message', (data: RawData, isBinary: boolean) => {
		if (!isBinary) {
			let m: any = {};
			try {
				m = JSON.parse(data.toString());
			} catch {}
			if (!ready) {
				if (!m.token) {
					ws.send(JSON.stringify({ type: 'error', message: 'handshake needs a token' }));
					return ws.close(4001, 'auth');
				}
				ready = true;
				sampleRate = m.sampleRate === 24000 ? 24000 : 16000;
				ws.send(JSON.stringify({ type: 'session.started' }));
				log('asr start', sampleRate);
				return;
			}
			if (/stop|end/.test(String(m.type ?? ''))) {
				if (bytes > 0) sendFinal();
				setTimeout(() => ws.close(1000, 'done'), 200);
			}
			return;
		}
		if (!ready) return;
		bytes += (data as Buffer).length;
		const seconds = bytes / (sampleRate * 2);
		const want = Math.min(WORDS.length, Math.floor(seconds * 2.5));
		if (want > shown && !finalSent) {
			shown = want;
			ws.send(JSON.stringify({ type: 'partial', text: WORDS.slice(0, shown).join(' ') }));
		}
		if (silence) clearTimeout(silence);
		// No audio for a while counts as the end of the turn.
		silence = setTimeout(() => ws.readyState === ws.OPEN && sendFinal(), 2000);
	});
	ws.on('close', () => silence && clearTimeout(silence));
});

server.on('upgrade', (req, socket, head) => {
	if ((req.url ?? '').split('?')[0] !== '/v1/asr/realtime') return socket.destroy();
	wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
});

server.listen(PORT, () => log(`fake Meta API on http://localhost:${PORT}/v1`));
