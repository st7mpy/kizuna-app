// Checks the realtime ASR handshake against the live API and prints every event.
//   MODEL_API_KEY=... node relay/scripts/asr-probe.mjs [wss-url]
// Sends the same handshake as relay/src/asr-upstream.ts, then 1 s of silence
// (PCM16 LE mono 16 kHz, paced in 100 ms frames), then {"type":"endStream"}.
// Needs Node 22+ (global WebSocket). Never prints the key.
const url = process.argv[2] || 'wss://api.meta.ai/v1/asr/realtime';
const key = process.env.MODEL_API_KEY;
if (!key) {
	console.error('Set MODEL_API_KEY first.');
	process.exit(2);
}
if (typeof WebSocket !== 'function') {
	console.error('This needs Node 22 or newer (global WebSocket).');
	process.exit(2);
}

const t0 = Date.now();
const at = () => `${String(Date.now() - t0).padStart(5)} ms`;
const sessionId = `probe-${Math.random().toString(36).slice(2, 10)}`;
const full = `${url}${url.includes('?') ? '&' : '?'}sessionId=${sessionId}`;
const handshake = {
	authorization: { accessToken: `Bearer ${key}` },
	model: 'muse-voice-transcribe-1.0',
	mode: 'ENDPOINTING',
	audioEncoding: 'PCM_16KHZ',
	partialMode: 'CUMULATIVE',
	emitAudioProgress: false,
	languageBias: ['English', 'Hindi']
};

console.log(`${at()}  connecting ${full}`);
const ws = new WebSocket(full);
ws.binaryType = 'arraybuffer';
let acked = false;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function sendSilence() {
	const frame = new ArrayBuffer(3200); // 100 ms at 16 kHz, 16-bit
	for (let i = 0; i < 10 && ws.readyState === WebSocket.OPEN; i++) {
		ws.send(frame);
		await sleep(100);
	}
	console.log(`${at()}  sent 1 s of silence`);
	if (ws.readyState === WebSocket.OPEN) {
		ws.send(JSON.stringify({ type: 'endStream' }));
		console.log(`${at()}  sent {"type":"endStream"}`);
	}
}

ws.onopen = () => {
	console.log(`${at()}  open; sending handshake (key hidden): ${JSON.stringify({ ...handshake, authorization: { accessToken: 'Bearer ***' } })}`);
	ws.send(JSON.stringify(handshake));
	// If no ack arrives, send audio anyway after 3 s to see what the server says.
	setTimeout(() => {
		if (!acked && ws.readyState === WebSocket.OPEN) {
			console.log(`${at()}  no ack after 3 s; sending audio anyway`);
			acked = true;
			void sendSilence();
		}
	}, 3000);
};
ws.onmessage = (ev) => {
	if (typeof ev.data !== 'string') {
		console.log(`${at()}  binary frame, ${ev.data.byteLength} bytes`);
		return;
	}
	console.log(`${at()}  frame: ${ev.data.slice(0, 500)}`);
	if (!acked) {
		acked = true;
		void sendSilence();
	}
};
ws.onerror = (ev) => console.log(`${at()}  error: ${ev?.message ?? ev?.error?.message ?? 'socket error'}`);
ws.onclose = (ev) => {
	console.log(`${at()}  closed code=${ev.code} reason=${JSON.stringify(ev.reason)} clean=${ev.wasClean}`);
	process.exit(0);
};
setTimeout(() => {
	console.log(`${at()}  timed out after 20 s; closing`);
	ws.close();
	setTimeout(() => process.exit(1), 500);
}, 20_000);
