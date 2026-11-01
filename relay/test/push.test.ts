import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetAllLimits } from '../src/ratelimit.ts';
import { createECDH, createHash, randomBytes } from 'node:crypto';
// @ts-expect-error no types for this small library
import ece from 'http_ece';
import { b64u, encryptPayload, fridayReminders, fromB64u, localNow, notifyAnswer, notifyPicked, type PushRecord, vapid, vapidJwt } from '../src/push.ts';
import { route } from '../src/index.ts';
import { makeEnv, post } from './helpers.ts';

async function vapidJwk(): Promise<string> {
	const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
	return JSON.stringify(await crypto.subtle.exportKey('jwk', pair.privateKey));
}

/** A browser-side subscription: its keys, so a test can decrypt what the server sends. */
function browser() {
	const ecdh = createECDH('prime256v1');
	ecdh.generateKeys();
	const auth = randomBytes(16);
	return {
		ecdh,
		auth,
		p256dh: b64u(new Uint8Array(ecdh.getPublicKey())),
		authB64: b64u(new Uint8Array(auth)),
		decrypt: (body: Uint8Array) => ece.decrypt(Buffer.from(body), { version: 'aes128gcm', privateKey: ecdh, authSecret: auth }).toString('utf8')
	};
}

async function envWithKey() {
	const env = makeEnv();
	env.VAPID_PRIVATE_JWK = await vapidJwk();
	return env;
}

beforeEach(() => resetAllLimits());
afterEach(() => vi.unstubAllGlobals());

describe('payload encryption', () => {
	it('is readable by the browser that subscribed (aes128gcm)', async () => {
		const b = browser();
		const body = await encryptPayload(b.p256dh, b.authB64, new TextEncoder().encode('{"kind":"answer"}'));
		expect(b.decrypt(body)).toBe('{"kind":"answer"}');
		// salt(16) + rs(4) + idlen(1) + key(65) + ciphertext(17 + 1 + 16)
		expect(body.length).toBe(16 + 4 + 1 + 65 + 18 + 16);
	});
});

describe('vapid', () => {
	it('signs a JWT the public key verifies, for the push service origin', async () => {
		const env = await envWithKey();
		const v = (await vapid(env))!;
		expect(fromB64u(v.publicKey).length).toBe(65);
		const jwt = await vapidJwt(v, 'https://web.push.apple.com/abc', 'https://kizuna.test', 0);
		const [h, c, s] = jwt.split('.');
		expect(JSON.parse(new TextDecoder().decode(fromB64u(c)))).toEqual({ aud: 'https://web.push.apple.com', exp: 12 * 3600, sub: 'https://kizuna.test' });
		const pub = await crypto.subtle.importKey('raw', fromB64u(v.publicKey), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
		expect(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pub, fromB64u(s), new TextEncoder().encode(`${h}.${c}`))).toBe(true);
	});

	it('reminders are off without the secret', async () => {
		const env = makeEnv();
		expect((await route(new Request('https://kizuna.test/api/push/key'), env)).status).toBe(404);
	});
});

describe('subscribe and notify', () => {
	const endpoint = 'https://web.push.apple.com/QHk-abc123';

	async function setup() {
		const env = await envWithKey();
		const b = browser();
		const sent: { url: string; headers: Headers; body: Uint8Array }[] = [];
		vi.stubGlobal(
			'fetch',
			vi.fn(async (url: string, init: RequestInit) => {
				sent.push({ url, headers: new Headers(init.headers), body: new Uint8Array(init.body as ArrayBuffer) });
				return new Response(null, { status: 201 });
			})
		);
		const res = await route(
			post('/api/push/sub', { endpoint, p256dh: b.p256dh, auth: b.authB64, timeZone: 'America/Chicago', circleId: 'circle123', memberId: 'me12345', invites: ['inv12345'] }),
			env
		);
		expect(res.status).toBe(200);
		return { env, b, sent };
	}

	it('checks the subscription it is given', async () => {
		const env = await envWithKey();
		const b = browser();
		const bad = (x: object) => route(post('/api/push/sub', { endpoint, p256dh: b.p256dh, auth: b.authB64, timeZone: 'UTC', ...x }), env);
		expect((await bad({ endpoint: 'https://evil.example/x' })).status).toBe(400);
		expect((await bad({ p256dh: 'abc' })).status).toBe(400);
		expect((await bad({ timeZone: 'Not/AZone' })).status).toBe(400);
	});

	it('tells the phone when someone else answers, never for its own write, at most every 10 minutes', async () => {
		const { env, b, sent } = await setup();
		expect(await notifyAnswer(env, 'circle123', 'me12345', 'https://kizuna.test', 1_000_000)).toBe(0);
		expect(await notifyAnswer(env, 'circle123', 'grandma1', 'https://kizuna.test', 1_000_000)).toBe(1);
		expect(sent[0].url).toBe(endpoint);
		expect(sent[0].headers.get('content-encoding')).toBe('aes128gcm');
		expect(sent[0].headers.get('authorization')).toMatch(/^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=[\w-]{87}$/);
		const msg = JSON.parse(b.decrypt(sent[0].body));
		expect(msg).toMatchObject({ kind: 'answer', title: 'Kizuna' });
		// general words only
		expect(msg.body).not.toMatch(/grandma/i);
		expect(await notifyAnswer(env, 'circle123', 'leo12345', 'https://kizuna.test', 1_000_000 + 60_000)).toBe(0);
		expect(await notifyAnswer(env, 'circle123', 'leo12345', 'https://kizuna.test', 1_000_000 + 11 * 60_000)).toBe(1);
	});

	it('tells the phone when its pick-a-time link is picked', async () => {
		const { env, b, sent } = await setup();
		expect(await notifyPicked(env, 'inv12345', 'https://kizuna.test')).toBe(1);
		expect(JSON.parse(b.decrypt(sent[0].body)).kind).toBe('picked');
		expect(await notifyPicked(env, 'other123', 'https://kizuna.test')).toBe(0);
	});

	it('sends the Friday reminder once, at 18:00 in the phone’s own time zone', async () => {
		const { env, sent } = await setup();
		const fri17 = Date.parse('2026-11-06T17:30:00-06:00');
		const fri18 = Date.parse('2026-11-06T18:05:00-06:00');
		const fri19 = Date.parse('2026-11-06T19:05:00-06:00');
		expect(localNow('America/Chicago', fri18)).toEqual({ weekday: 5, hour: 18, day: '2026-11-06' });
		expect(await fridayReminders(env, 'https://kizuna.test', fri17)).toBe(0);
		expect(await fridayReminders(env, 'https://kizuna.test', fri18)).toBe(1);
		expect(await fridayReminders(env, 'https://kizuna.test', fri19)).toBe(0);
		expect(sent).toHaveLength(1);
	});

	it('forgets a subscription the browser dropped', async () => {
		const { env } = await setup();
		vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 410 })));
		await notifyPicked(env, 'inv12345', 'https://kizuna.test');
		const h = b64u(new Uint8Array(createHash('sha256').update(endpoint).digest()).slice(0, 12));
		expect(await env.INVITES.get(`push:${h}`)).toBeNull();
		expect(await env.INVITES.get(`pushc:circle123:${h}`)).toBeNull();
	});

	it('unsubscribes', async () => {
		const { env } = await setup();
		expect((await route(post('/api/push/unsub', { endpoint }), env)).status).toBe(200);
		expect(await fridayReminders(env, 'https://kizuna.test', Date.parse('2026-11-06T18:05:00-06:00'))).toBe(0);
	});
});

describe('stored record', () => {
	it('keeps no note text, only where to send and what to watch', async () => {
		const env = await envWithKey();
		const b = browser();
		vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 201 })));
		await route(post('/api/push/sub', { endpoint: 'https://fcm.googleapis.com/fcm/send/x1', p256dh: b.p256dh, auth: b.authB64, timeZone: 'UTC', note: 'Mom knee surgery' }), env);
		const recs = [...env.kv.store.entries()].filter(([k]) => k.startsWith('push:')).map(([, v]) => JSON.parse(v.value) as PushRecord);
		expect(recs).toHaveLength(1);
		expect(JSON.stringify(recs[0])).not.toMatch(/knee/);
	});
});
