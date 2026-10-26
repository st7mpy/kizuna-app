import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CIRCLE_LIMITS, newCircleKey, openEntry, randomId, sealEntry, type CircleEntry, type CircleState } from '@kizuna/shared';
import { route } from '../src/index.ts';
import { resetAllLimits } from '../src/ratelimit.ts';
import { parseSealed } from '../src/circle.ts';
import { get, makeEnv, MemoryKV, post } from './helpers.ts';

function req(method: string, path: string, body?: unknown, ip = '203.0.113.9'): Request {
	return new Request(`https://kizuna.test${path}`, {
		method,
		headers: { 'content-type': 'application/json', 'cf-connecting-ip': ip, 'x-kizuna-device': 'dev1' },
		body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body)
	});
}

const entry = (name: string): CircleEntry => ({
	v: 1,
	name,
	tz: 'Asia/Kolkata',
	status: 'free',
	statusUntil: '2026-10-31T06:00:00+05:30',
	windows: [{ start: '2026-11-01T09:00:00+05:30', end: '2026-11-01T12:00:00+05:30' }],
	via: 'app',
	updatedAt: '2026-10-30T18:00:00+05:30'
});

async function create(env = makeEnv()) {
	const res = await route(post('/api/circle', {}), env);
	expect(res.status).toBe(201);
	return { env, body: (await res.json()) as { ok: true; id: string; url: string } };
}

beforeEach(() => resetAllLimits());

describe('circle routes', () => {
	it('creates a circle, stores sealed entries and lists them back', async () => {
		const { env, body } = await create();
		expect(body.id).toMatch(/^[A-Za-z0-9_-]{16}$/);
		expect(body.url).toBe(`https://kizuna.test/c/${body.id}`);
		const key = newCircleKey();
		const mum = randomId(12);
		const sealed = await sealEntry(key, body.id, mum, entry('Mum'));
		const put = await route(req('PUT', `/api/circle/${body.id}/m/${mum}`, sealed), env);
		expect(put.status).toBe(200);
		expect(await put.json()).toEqual({ ok: true });
		// Only ciphertext reached the store.
		const stored = [...env.kv.store.values()].map((v) => v.value).join('\n');
		expect(stored).not.toContain('Mum');
		expect(stored).not.toContain('Asia/Kolkata');

		const res = await route(get(`/api/circle/${body.id}`), env);
		const state = (await res.json()) as CircleState;
		expect(state).toEqual({ ok: true, id: body.id, members: [{ memberId: mum, ...sealed }] });
		expect(await openEntry(key, body.id, mum, state.members[0])).toEqual(entry('Mum'));
		expect(res.headers.get('cache-control')).toBe('no-store');
	});

	it('sets the 8-day TTL and reads small entries from metadata', async () => {
		const { env, body } = await create();
		const id = randomId(12);
		const t0 = Date.now();
		await route(req('PUT', `/api/circle/${body.id}/m/${id}`, await sealEntry(newCircleKey(), body.id, id, entry('Riya'))), env);
		const rec = env.kv.store.get(`circle:${body.id}:m:${id}`)!;
		expect(Math.round((rec.expires! - t0) / 1000)).toBeGreaterThanOrEqual(CIRCLE_LIMITS.entryTtlSeconds - 1);
		expect(Math.round((rec.expires! - t0) / 1000)).toBeLessThanOrEqual(CIRCLE_LIMITS.entryTtlSeconds + 1);
		expect(rec.metadata).toMatchObject({ iv: expect.any(String), ct: expect.any(String) });
		const getSpy = vi.spyOn(env.kv, 'get');
		await route(get(`/api/circle/${body.id}`), env);
		expect(getSpy).toHaveBeenCalledTimes(1); // the circle record only
		// Expired entries vanish.
		env.kv.now = () => t0 + (CIRCLE_LIMITS.entryTtlSeconds + 5) * 1000;
		const later = (await (await route(get(`/api/circle/${body.id}`), env)).json()) as CircleState;
		expect(later.members).toEqual([]);
	});

	it('reads big entries with a get', async () => {
		const { env, body } = await create();
		const id = randomId(12);
		const big = await sealEntry(newCircleKey(), body.id, id, { ...entry('Nani'), name: 'N'.repeat(40), tz: 'x'.repeat(900) });
		expect((await route(req('PUT', `/api/circle/${body.id}/m/${id}`, big), env)).status).toBe(200);
		expect(env.kv.store.get(`circle:${body.id}:m:${id}`)!.metadata).toBeUndefined();
		const state = (await (await route(get(`/api/circle/${body.id}`), env)).json()) as CircleState;
		expect(state.members[0]).toEqual({ memberId: id, ...big });
	});

	it('overwrites a member in place and lets them leave', async () => {
		const { env, body } = await create();
		const key = newCircleKey();
		const id = randomId(12);
		await route(req('PUT', `/api/circle/${body.id}/m/${id}`, await sealEntry(key, body.id, id, entry('Papa'))), env);
		await route(req('PUT', `/api/circle/${body.id}/m/${id}`, await sealEntry(key, body.id, id, { ...entry('Papa'), status: null })), env);
		let state = (await (await route(get(`/api/circle/${body.id}`), env)).json()) as CircleState;
		expect(state.members).toHaveLength(1);
		expect((await openEntry(key, body.id, id, state.members[0]))?.status).toBeNull();
		expect((await route(req('DELETE', `/api/circle/${body.id}/m/${id}`), env)).status).toBe(200);
		state = (await (await route(get(`/api/circle/${body.id}`), env)).json()) as CircleState;
		expect(state.members).toEqual([]);
	});

	it('holds at most 12 members', async () => {
		const { env, body } = await create();
		const key = newCircleKey();
		for (let i = 0; i < CIRCLE_LIMITS.maxMembers; i++) {
			const id = randomId(12);
			const r = await route(req('PUT', `/api/circle/${body.id}/m/${id}`, await sealEntry(key, body.id, id, entry(`P${i}`)), `198.51.100.${i}`), env);
			expect(r.status).toBe(200);
		}
		const extra = randomId(12);
		const res = await route(req('PUT', `/api/circle/${body.id}/m/${extra}`, await sealEntry(key, body.id, extra, entry('X')), '198.51.100.99'), env);
		expect(res.status).toBe(400);
		expect(await res.json()).toMatchObject({ detail: 'circle_full' });
	});

	it('validates ids and the sealed body', async () => {
		const { env, body } = await create();
		const id = randomId(12);
		expect((await route(req('PUT', `/api/circle/short/m/${id}`, { iv: 'a', ct: 'b' }), env)).status).toBe(400);
		expect((await route(req('PUT', `/api/circle/${body.id}/m/bad.id!!!!!!`, { iv: 'a', ct: 'b' }), env)).status).toBe(400);
		expect((await route(req('PUT', `/api/circle/${body.id}/m/${id}`, '{nope'), env)).status).toBe(400);
		expect((await route(req('PUT', `/api/circle/${body.id}/m/${id}`, { iv: 'AAAAAAAAAAAAAAAA', ct: 'not base64!' }), env)).status).toBe(400);
		expect((await route(req('PUT', `/api/circle/${body.id}/m/${id}`, { iv: 'AAAA', ct: 'A'.repeat(40) }), env)).status).toBe(400);
		const tooBig = await route(req('PUT', `/api/circle/${body.id}/m/${id}`, { iv: 'A'.repeat(16), ct: 'A'.repeat(5600) }), env);
		expect(tooBig.status).toBe(413);
		const wayTooBig = await route(req('PUT', `/api/circle/${body.id}/m/${id}`, { iv: 'A'.repeat(16), ct: 'A'.repeat(20_000) }), env);
		expect(wayTooBig.status).toBe(413);
		expect(parseSealed({ iv: 'A'.repeat(16), ct: 'A'.repeat(32) })).toEqual({ iv: 'A'.repeat(16), ct: 'A'.repeat(32) });
		expect(parseSealed([])).toBe('bad_request');
	});

	it('404s unknown circles', async () => {
		const env = makeEnv();
		const id = randomId(16);
		expect((await route(get(`/api/circle/${id}`), env)).status).toBe(404);
		expect((await route(get('/api/circle/x'), env)).status).toBe(404);
		const m = randomId(12);
		const res = await route(req('PUT', `/api/circle/${id}/m/${m}`, await sealEntry(newCircleKey(), id, m, entry('A'))), env);
		expect(res.status).toBe(404);
	});

	it('rejects wrong methods', async () => {
		const env = makeEnv();
		expect((await route(get('/api/circle'), env)).status).toBe(405);
		expect((await route(req('POST', `/api/circle/${randomId(16)}`, {}), env)).status).toBe(405);
		expect((await route(req('GET', `/api/circle/${randomId(16)}/m/${randomId(12)}`), env)).status).toBe(405);
	});

	it('rate limits writes per IP and circle, and honours the edge binding', async () => {
		const { env, body } = await create();
		const key = newCircleKey();
		const id = randomId(12);
		const sealed = await sealEntry(key, body.id, id, entry('A'));
		const codes: number[] = [];
		for (let i = 0; i < 10; i++) codes.push((await route(req('PUT', `/api/circle/${body.id}/m/${id}`, sealed), env)).status);
		expect(codes.filter((c) => c === 429)).toHaveLength(4); // burst of 6
		// Another IP on the same circle is fine.
		expect((await route(req('PUT', `/api/circle/${body.id}/m/${id}`, sealed, '198.51.100.7'), env)).status).toBe(200);

		resetAllLimits();
		const limit = vi.fn(async () => ({ success: false }));
		const edged = { ...env, RL_INVITE: { limit } as unknown as RateLimit };
		expect((await route(req('PUT', `/api/circle/${body.id}/m/${id}`, sealed), edged)).status).toBe(429);
		expect(limit).toHaveBeenCalledWith({ key: `203.0.113.9|${body.id}` });
	});

	it('limits circle creation per phone', async () => {
		const env = makeEnv();
		const codes: number[] = [];
		for (let i = 0; i < 5; i++) codes.push((await route(post('/api/circle', {}), env)).status);
		expect(codes.slice(0, 3)).toEqual([201, 201, 201]);
		expect(codes.slice(3)).toEqual([429, 429]);
	});

	it('stops writes at the daily KV write cap', async () => {
		const kv = new MemoryKV();
		const env = { ...makeEnv(kv), KV_WRITES_PER_DAY: '1' };
		expect((await route(post('/api/circle', {}), env)).status).toBe(201);
		const res = await route(post('/api/circle', {}), env);
		expect(res.status).toBe(429);
		expect(await res.json()).toMatchObject({ detail: 'daily_writes' });
	});

	it('refreshes the circle record at most once a day', async () => {
		const { env, body } = await create();
		const id = randomId(12);
		const sealed = await sealEntry(newCircleKey(), body.id, id, entry('A'));
		const before = env.kv.writes;
		await route(req('PUT', `/api/circle/${body.id}/m/${id}`, sealed), env);
		expect(env.kv.writes - before).toBe(1);
		const rec = JSON.parse(env.kv.store.get(`circle:${body.id}`)!.value);
		env.kv.store.get(`circle:${body.id}`)!.value = JSON.stringify({ ...rec, touchedAt: '2020-01-01T00:00:00Z' });
		await route(req('PUT', `/api/circle/${body.id}/m/${id}`, sealed), env);
		expect(env.kv.writes - before).toBe(3);
		expect(JSON.parse(env.kv.store.get(`circle:${body.id}`)!.value).touchedAt).not.toBe('2020-01-01T00:00:00Z');
	});
});
