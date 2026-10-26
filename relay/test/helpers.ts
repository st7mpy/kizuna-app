import type { Env } from '../src/env.ts';

/** In-memory KV with expiry, enough for the invite code. */
export class MemoryKV {
	store = new Map<string, { value: string; expires: number | null; metadata?: unknown }>();
	writes = 0;
	now = () => Date.now();
	async get(key: string, type?: 'json' | 'text'): Promise<any> {
		const e = this.store.get(key);
		if (!e) return null;
		if (e.expires != null && e.expires <= this.now()) {
			this.store.delete(key);
			return null;
		}
		return type === 'json' ? JSON.parse(e.value) : e.value;
	}
	async put(key: string, value: string, opts: { expirationTtl?: number; expiration?: number; metadata?: unknown } = {}): Promise<void> {
		const expires = opts.expiration ? opts.expiration * 1000 : opts.expirationTtl ? this.now() + opts.expirationTtl * 1000 : null;
		this.writes++;
		this.store.set(key, { value, expires, metadata: opts.metadata });
	}
	async list(opts: { prefix?: string } = {}): Promise<{ keys: { name: string; metadata?: unknown }[]; list_complete: true }> {
		const keys = [...this.store.entries()]
			.filter(([k, e]) => k.startsWith(opts.prefix ?? '') && (e.expires == null || e.expires > this.now()))
			.map(([name, e]) => ({ name, metadata: e.metadata }));
		return { keys, list_complete: true };
	}
	async delete(key: string): Promise<void> {
		this.store.delete(key);
	}
}

export function makeEnv(kv = new MemoryKV()): Env & { kv: MemoryKV } {
	return {
		kv,
		INVITES: kv as unknown as KVNamespace,
		ASSETS: { fetch: async () => new Response('app shell', { headers: { 'content-type': 'text/html' } }) } as unknown as Fetcher,
		META_BASE_URL: 'https://meta.test/v1',
		MODEL_API_KEY: 'test-key'
	};
}

export function post(path: string, body: unknown, headers: Record<string, string> = {}): Request {
	return new Request(`https://kizuna.test${path}`, {
		method: 'POST',
		headers: { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.9', 'x-kizuna-device': 'dev1', ...headers },
		body: typeof body === 'string' ? body : JSON.stringify(body)
	});
}

export function get(path: string, headers: Record<string, string> = {}): Request {
	return new Request(`https://kizuna.test${path}`, { headers: { 'cf-connecting-ip': '203.0.113.9', ...headers } });
}

/** A chat completions response body. */
export function completion(message: Record<string, unknown>, usage = { prompt_tokens: 10, completion_tokens: 5 }): Response {
	return new Response(JSON.stringify({ choices: [{ index: 0, message: { role: 'assistant', content: null, ...message } }], usage }), {
		headers: { 'content-type': 'application/json' }
	});
}
