// Response helpers. API responses carry strict security headers and are never cached.

export const API_HEADERS: Record<string, string> = {
	'content-type': 'application/json; charset=utf-8',
	'cache-control': 'no-store',
	'x-content-type-options': 'nosniff',
	'referrer-policy': 'no-referrer',
	'x-frame-options': 'DENY',
	'cross-origin-resource-policy': 'same-origin',
	'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
	'permissions-policy': 'camera=(), microphone=(), geolocation=()'
};

export function json(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
	return new Response(JSON.stringify(body), { status, headers: { ...API_HEADERS, ...extra } });
}

export type ApiError = 'bad_request' | 'rate_limited' | 'model_error' | 'invalid_output' | 'too_large' | 'not_found' | 'expired' | 'fetch_failed' | 'parse_failed' | 'method_not_allowed' | 'server_error';

const STATUS: Record<ApiError, number> = {
	bad_request: 400,
	rate_limited: 429,
	model_error: 502,
	invalid_output: 502,
	too_large: 413,
	not_found: 404,
	expired: 410,
	fetch_failed: 502,
	parse_failed: 422,
	method_not_allowed: 405,
	server_error: 500
};

export function fail(error: ApiError, detail?: string, retryAfterS = 30): Response {
	const extra: Record<string, string> = error === 'rate_limited' ? { 'retry-after': String(retryAfterS) } : {};
	return json(detail ? { ok: false, error, detail } : { ok: false, error }, STATUS[error], extra);
}

/** Reads at most `max` bytes of a stream; returns null if it is longer. */
export async function readCapped(body: ReadableStream<Uint8Array> | null, max: number): Promise<Uint8Array | null> {
	if (!body) return new Uint8Array(0);
	const reader = body.getReader();
	const chunks: Uint8Array[] = [];
	let size = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		size += value.byteLength;
		if (size > max) {
			await reader.cancel().catch(() => {});
			return null;
		}
		chunks.push(value);
	}
	const out = new Uint8Array(size);
	let at = 0;
	for (const c of chunks) {
		out.set(c, at);
		at += c.byteLength;
	}
	return out;
}

/** Request body as bytes, or null when over `max` (checks Content-Length first). */
export async function readBody(req: Request, max: number): Promise<Uint8Array | null> {
	const len = Number(req.headers.get('content-length') ?? NaN);
	if (Number.isFinite(len) && len > max) return null;
	return readCapped(req.body, max);
}

export function escapeHtml(s: unknown): string {
	return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
