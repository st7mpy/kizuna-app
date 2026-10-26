// Record-then-transcribe fallback: POST a WAV to the relay.
import type { TranscribeResponse } from '@kizuna/shared';

export interface TranscribeOptions {
	origin?: string; // defaults to the page origin
	languageBias?: string[];
	fetch?: typeof fetch;
	signal?: AbortSignal;
}

export async function transcribeBlob(blob: Blob, opts: TranscribeOptions = {}): Promise<string> {
	const origin = opts.origin ?? (typeof location !== 'undefined' ? location.origin : '');
	const doFetch = opts.fetch ?? fetch;
	const lang = opts.languageBias?.length ? `?lang=${encodeURIComponent(opts.languageBias.join(','))}` : '';
	const res = await doFetch(`${origin}/api/transcribe${lang}`, {
		method: 'POST',
		headers: { 'Content-Type': 'audio/wav' },
		body: blob,
		signal: opts.signal
	});
	let body: Partial<TranscribeResponse> & { error?: string } = {};
	try {
		body = await res.json();
	} catch {
		/* not JSON */
	}
	if (!res.ok || body.ok !== true || typeof body.text !== 'string') {
		throw new Error(body.error ? `transcribe failed: ${body.error}` : `transcribe failed (${res.status})`);
	}
	return body.text.trim();
}
