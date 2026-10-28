// Record-then-transcribe fallback: POST a WAV to the relay.
import { markResting } from '../core/relay.ts';
import type { TranscribeResponse } from '@kizuna/shared';

export interface TranscribeOptions {
	origin?: string; // defaults to the page origin
	languageBias?: string[];
	fetch?: typeof fetch;
	signal?: AbortSignal;
	device?: string; // per-install id, for the relay's per-phone limit
	session?: string; // the listening session; its socket already paid the voice try
}

export async function transcribeBlob(blob: Blob, opts: TranscribeOptions = {}): Promise<string> {
	const origin = opts.origin ?? (typeof location !== 'undefined' ? location.origin : '');
	const doFetch = opts.fetch ?? fetch;
	const q = new URLSearchParams();
	if (opts.languageBias?.length) q.set('lang', opts.languageBias.join(','));
	if (opts.device) q.set('device', opts.device);
	if (opts.session) q.set('session', opts.session);
	const qs = q.size ? `?${q}` : '';
	const headers: Record<string, string> = { 'Content-Type': 'audio/wav' };
	if (opts.device) headers['x-kizuna-device'] = opts.device;
	const res = await doFetch(`${origin}/api/transcribe${qs}`, {
		method: 'POST',
		headers,
		body: blob,
		signal: opts.signal
	});
	let body: Partial<TranscribeResponse> & { error?: string } = {};
	try {
		body = await res.json();
	} catch {
		/* not JSON */
	}
	if (!res.ok && body.error === 'rate_limited' && (body as { detail?: string }).detail === 'daily_budget') {
		markResting(Number(res.headers?.get?.('retry-after')) || 3600);
	}
	if (!res.ok || body.ok !== true || typeof body.text !== 'string') {
		throw new Error(body.error ? `transcribe failed: ${body.error}` : `transcribe failed (${res.status})`);
	}
	return body.text.trim();
}
