import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { relayJson, RelayError, TASK_TIMEOUTS } from './relay.ts';
import { resetDb, setOffline } from './testing.ts';

beforeEach(async () => {
	setOffline(false);
	await resetDb();
});
afterEach(() => {
	vi.unstubAllGlobals();
});

describe('relayJson', () => {
	it('times out when the headers arrive but the body stalls', async () => {
		// Headers come back at once; the body never finishes.
		const body = new ReadableStream({ start: (c) => c.enqueue(new TextEncoder().encode('{"ok":')) });
		vi.stubGlobal('fetch', vi.fn(async () => new Response(body, { status: 200 })));
		const t0 = Date.now();
		const e = await relayJson('/api/spark', { body: {}, timeoutMs: 150 }).catch((x) => x);
		expect(Date.now() - t0).toBeLessThan(1_000);
		expect(e).toBeInstanceOf(RelayError);
		expect((e as RelayError).code).toBe('timeout');
	});

	it('reads a normal answer', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => new Response('{"ok":true}', { status: 200 })));
		expect(await relayJson('/api/x', { timeoutMs: 1_000 })).toEqual({ ok: true });
	});

	it('names the relay error from the body', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => new Response('{"ok":false,"error":"rate_limited"}', { status: 429 })));
		await expect(relayJson('/api/x')).rejects.toMatchObject({ code: 'rate_limited' });
	});

	it('keeps the draft wait short: a simple line is already on screen', () => {
		expect(TASK_TIMEOUTS.draft).toBeLessThanOrEqual(8_000);
	});
});
