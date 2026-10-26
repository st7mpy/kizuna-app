// POST /api/transcribe: a WAV recording -> text, via the ASR file endpoint.
import { ASR_MODEL } from '@kizuna/shared';
import { metaBase, type Env } from './env.ts';
import { fail, json, readBody } from './http.ts';
import { limits } from './ratelimit.ts';

export const MAX_WAV_BYTES = 32 * 1024 * 1024;

function isWav(b: Uint8Array): boolean {
	const ascii = (from: number) => String.fromCharCode(...b.subarray(from, from + 4));
	return b.byteLength > 44 && ascii(0) === 'RIFF' && ascii(8) === 'WAVE';
}

function textOf(v: any): string | null {
	if (typeof v === 'string') return v;
	if (!v || typeof v !== 'object') return null;
	for (const k of ['text', 'transcript', 'transcription']) if (typeof v[k] === 'string') return v[k];
	for (const k of ['result', 'data', 'output']) {
		const t = textOf(v[k]);
		if (t != null) return t;
	}
	for (const k of ['results', 'segments', 'transcripts', 'utterances', 'alternatives']) {
		if (Array.isArray(v[k])) {
			const parts = v[k].map(textOf).filter((t: string | null): t is string => !!t);
			if (parts.length) return parts.join(' ');
		}
	}
	return null;
}

/** Reads text out of JSON, JSON lines / server-sent events, or plain text. */
export function transcriptFrom(body: string, contentType: string): string {
	const trimmed = body.trim();
	if (contentType.includes('json') || trimmed.startsWith('{') || trimmed.startsWith('[')) {
		try {
			const t = textOf(JSON.parse(trimmed));
			if (t != null) return t.trim();
		} catch {
			/* maybe JSON lines */
		}
	}
	const lines = trimmed.split(/\r?\n/).map((l) => l.replace(/^data:\s*/, '').trim()).filter(Boolean);
	const parsed = lines.map((l) => {
		try {
			return JSON.parse(l);
		} catch {
			return undefined;
		}
	});
	if (parsed.some((p) => p !== undefined)) {
		const finals = parsed.filter((p) => p && (p.isFinal || p.is_final || p.final || /final|complete/i.test(p.type ?? '')));
		const use = finals.length ? finals : parsed.slice(-1);
		return use.map(textOf).filter(Boolean).join(' ').trim();
	}
	return trimmed;
}

export async function handleTranscribe(req: Request, env: Env): Promise<Response> {
	if (!limits.voice.allow(req)) return fail('rate_limited');
	const audio = await readBody(req, MAX_WAV_BYTES);
	if (!audio) return fail('too_large');
	if (!isWav(audio)) return fail('bad_request', 'expected a WAV file');

	const form = new FormData();
	const languageBias = (new URL(req.url).searchParams.get('lang') ?? '')
		.split(',')
		.map((x) => x.trim().toLowerCase())
		.filter((x) => /^[a-z]{2,3}(-[a-z0-9]{2,8})?$/.test(x))
		.slice(0, 5);
	const request: Record<string, unknown> = { mode: 'ENDPOINTING', model: ASR_MODEL, audioEncoding: 'WAV' };
	if (languageBias.length) request.languageBias = languageBias;
	form.append('request', JSON.stringify(request));
	form.append('audio', new Blob([audio], { type: 'audio/wav' }), 'note.wav');
	let res: Response;
	try {
		res = await fetch(`${metaBase(env)}/asr/transcribe?sessionId=${crypto.randomUUID()}`, {
			method: 'POST',
			headers: { authorization: `Bearer ${env.MODEL_API_KEY ?? ''}`, accept: 'application/json' },
			body: form,
			signal: AbortSignal.timeout(120_000)
		});
	} catch {
		return fail('model_error');
	}
	if (!res.ok) {
		await res.body?.cancel().catch(() => {});
		console.error(`transcribe: upstream ${res.status}`);
		return fail('model_error');
	}
	const text = transcriptFrom(await res.text(), res.headers.get('content-type') ?? '');
	return json({ ok: true, text });
}
