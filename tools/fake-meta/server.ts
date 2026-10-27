// Local fake of the Meta API, so Kizuna runs end to end without a key.
//   node --experimental-strip-types server.ts      (port 8788, or PORT)
// Routes: POST /v1/chat/completions, WS /v1/asr/realtime, POST /v1/asr/transcribe.
// Logs method, path, task and status only; never request contents.
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { WebSocketServer, type WebSocket, type RawData } from 'ws';
import { CANNED_SENTENCE, detectTask, fakeCompletion } from './fake.ts';
import { fakeAsrSession } from './asr.ts';

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

// ---- realtime ASR: same protocol as the real upstream (see asr.ts) ----
const wss = new WebSocketServer({ noServer: true });

wss.on('connection', (ws: WebSocket) => {
	const session = fakeAsrSession(
		{ send: (t) => ws.readyState === ws.OPEN && ws.send(t), close: (code, reason) => ws.close(code, reason) },
		{ log }
	);
	ws.on('message', (data: RawData, isBinary: boolean) => {
		if (isBinary) session.binary((data as Buffer).length);
		else session.text(data.toString());
	});
	ws.on('close', () => session.close());
});

server.on('upgrade', (req, socket, head) => {
	if ((req.url ?? '').split('?')[0] !== '/v1/asr/realtime') return socket.destroy();
	wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
});

server.listen(PORT, () => log(`fake Meta API on http://localhost:${PORT}/v1`));
