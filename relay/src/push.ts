// Reminders on the phone (Web Push, RFC 8030/8291/8292), with no library.
// The server keeps only where to send (the browser's push address), the time zone, and which
// family page or pick-a-time links to watch. Never notes. The words are general, always.
//
// KV keys:
//   push:<h>                 the subscription record (60 days, renewed when the app opens)
//   pushc:<circleId>:<h>     "tell <h> when someone answers on this family page"
//   pushi:<inviteId>:<h>     "tell <h> when this pick-a-time link is picked"
// <h> = a short hash of the push address.
import type { Env } from './env.ts';
import { fail, json, readBody } from './http.ts';
import { edgeAllow, limits } from './ratelimit.ts';
import { canWrite, wrote } from './budget.ts';

export type PushKind = 'answer' | 'picked' | 'weekend';

export const PUSH_TEXT: Record<PushKind, { title: string; body: string; url: string }> = {
	answer: { title: 'Kizuna', body: 'Someone answered on your family page.', url: '/map' },
	picked: { title: 'Kizuna', body: 'A time was picked for your call.', url: '/' },
	weekend: { title: 'Kizuna', body: 'This weekend’s call is ready to look at.', url: '/' }
};

const SUB_TTL_S = 60 * 24 * 3600;
const WATCH_INVITE_TTL_S = 8 * 24 * 3600;
const ANSWER_GAP_MS = 10 * 60 * 1000; // one "someone answered" per 10 minutes at most
const FRIDAY_HOUR = 18;
const ID_RE = /^[A-Za-z0-9_-]{6,64}$/;
const MAX_INVITES = 10;

export interface PushRecord {
	endpoint: string;
	p256dh: string; // base64url, 65-byte P-256 point
	auth: string; // base64url, 16 bytes
	timeZone: string;
	circleId?: string;
	memberId?: string;
	invites: string[];
	lastFriday?: string; // the local date of the last Friday reminder
	lastAnswerAt?: number;
}

// ---------------------------------------------------------------- base64url
export function b64u(bytes: Uint8Array): string {
	let s = '';
	for (const b of bytes) s += String.fromCharCode(b);
	return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function fromB64u(s: string): Uint8Array {
	const pad = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
	const bin = atob(pad);
	const out = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
	return out;
}
const enc = new TextEncoder();
function concat(...parts: Uint8Array[]): Uint8Array {
	const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
	let o = 0;
	for (const p of parts) {
		out.set(p, o);
		o += p.length;
	}
	return out;
}

async function hashOf(endpoint: string): Promise<string> {
	const d = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(endpoint)));
	return b64u(d.slice(0, 12));
}

// ---------------------------------------------------------------- VAPID (RFC 8292)
interface Vapid {
	key: CryptoKey;
	publicKey: string; // base64url uncompressed point, what the browser needs
}
let vapidCache: { jwk: string; v: Vapid } | null = null;

/** VAPID_PRIVATE_JWK is a P-256 private key as JWK JSON (secret, set with wrangler). */
export async function vapid(env: Env): Promise<Vapid | null> {
	const raw = env.VAPID_PRIVATE_JWK;
	if (!raw) return null;
	if (vapidCache?.jwk === raw) return vapidCache.v;
	try {
		const jwk = JSON.parse(raw) as JsonWebKey;
		if (!jwk.x || !jwk.y || !jwk.d) return null;
		const key = await crypto.subtle.importKey('jwk', { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y, d: jwk.d }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
		const publicKey = b64u(concat(new Uint8Array([4]), fromB64u(jwk.x), fromB64u(jwk.y)));
		vapidCache = { jwk: raw, v: { key, publicKey } };
		return vapidCache.v;
	} catch {
		return null;
	}
}

export async function vapidJwt(v: Vapid, endpoint: string, subject: string, now = Date.now()): Promise<string> {
	const header = b64u(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
	const claims = b64u(enc.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + 12 * 3600, sub: subject })));
	const input = `${header}.${claims}`;
	const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, v.key, enc.encode(input)));
	return `${input}.${b64u(sig)}`;
}

// ---------------------------------------------------------------- payload encryption (RFC 8291, aes128gcm)
async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, bytes: number): Promise<Uint8Array> {
	const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
	return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, bytes * 8));
}

/** Encrypts `plaintext` for one subscription. `eph` and `salt` are injectable for tests. */
export async function encryptPayload(
	p256dh: string,
	auth: string,
	plaintext: Uint8Array,
	eph?: CryptoKeyPair,
	salt: Uint8Array = crypto.getRandomValues(new Uint8Array(16))
): Promise<Uint8Array> {
	const uaPub = fromB64u(p256dh);
	const authSecret = fromB64u(auth);
	const pair = eph ?? ((await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair);
	const asPub = new Uint8Array((await crypto.subtle.exportKey('raw', pair.publicKey)) as ArrayBuffer);
	const uaKey = await crypto.subtle.importKey('raw', uaPub, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
	const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey } as any, pair.privateKey, 256));
	const ikm = await hkdf(authSecret, shared, concat(enc.encode('WebPush: info\0'), uaPub, asPub), 32);
	const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
	const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
	const aes = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
	const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aes, concat(plaintext, new Uint8Array([2]))));
	const rs = new Uint8Array([0, 0, 16, 0]); // 4096
	return concat(salt, rs, new Uint8Array([asPub.length]), asPub, ct);
}

/** Sends one notification. Returns 'gone' when the browser has dropped the subscription. */
export async function sendPush(env: Env, rec: PushRecord, kind: PushKind, origin: string, now = Date.now()): Promise<'ok' | 'gone' | 'failed'> {
	const v = await vapid(env);
	if (!v) return 'failed';
	try {
		const body = await encryptPayload(rec.p256dh, rec.auth, enc.encode(JSON.stringify({ kind, ...PUSH_TEXT[kind] })));
		const res = await fetch(rec.endpoint, {
			method: 'POST',
			headers: {
				authorization: `vapid t=${await vapidJwt(v, rec.endpoint, origin, now)}, k=${v.publicKey}`,
				'content-encoding': 'aes128gcm',
				'content-type': 'application/octet-stream',
				ttl: String(kind === 'weekend' ? 6 * 3600 : 24 * 3600),
				urgency: 'normal'
			},
			body
		});
		if (res.status === 404 || res.status === 410) return 'gone';
		return res.ok ? 'ok' : 'failed';
	} catch {
		return 'failed';
	}
}

// ---------------------------------------------------------------- the API
const PUSH_HOSTS = /^https:\/\/([a-z0-9-]+\.)*(push\.apple\.com|fcm\.googleapis\.com|googleapis\.com|push\.services\.mozilla\.com|notify\.windows\.com)\//;

function validTz(tz: unknown): tz is string {
	if (typeof tz !== 'string' || tz.length > 64) return false;
	try {
		new Intl.DateTimeFormat('en-US', { timeZone: tz });
		return true;
	} catch {
		return false;
	}
}

/** GET /api/push/key: the public key the browser subscribes with (404 when reminders are off). */
export async function pushKey(env: Env): Promise<Response> {
	const v = await vapid(env);
	return v ? json({ ok: true, key: v.publicKey }) : fail('not_found');
}

async function readJson(req: Request): Promise<any> {
	const bytes = await readBody(req, 4_000);
	if (!bytes) return 'too_large';
	try {
		return JSON.parse(new TextDecoder().decode(bytes));
	} catch {
		return null;
	}
}

/** POST /api/push/sub {endpoint, p256dh, auth, timeZone, circleId?, memberId?, invites?} */
export async function subscribe(req: Request, env: Env, now = Date.now()): Promise<Response> {
	if (!limits.push.allow(req) || !(await edgeAllow(env.RL_INVITE, req, 'push'))) return fail('rate_limited');
	if (!(await vapid(env))) return fail('not_found');
	const b = await readJson(req);
	if (b === 'too_large') return fail('too_large');
	if (!b || typeof b !== 'object') return fail('bad_request');
	const { endpoint, p256dh, auth, timeZone } = b;
	if (typeof endpoint !== 'string' || endpoint.length > 1000 || !PUSH_HOSTS.test(endpoint)) return fail('bad_request', 'endpoint');
	if (typeof p256dh !== 'string' || fromB64uSafe(p256dh)?.length !== 65) return fail('bad_request', 'p256dh');
	if (typeof auth !== 'string' || fromB64uSafe(auth)?.length !== 16) return fail('bad_request', 'auth');
	if (!validTz(timeZone)) return fail('bad_request', 'timeZone');
	const circleId = typeof b.circleId === 'string' && ID_RE.test(b.circleId) ? b.circleId : undefined;
	const memberId = typeof b.memberId === 'string' && ID_RE.test(b.memberId) ? b.memberId : undefined;
	const invites = (Array.isArray(b.invites) ? b.invites : []).filter((x: unknown): x is string => typeof x === 'string' && ID_RE.test(x)).slice(0, MAX_INVITES);
	if (!(await canWrite(env, now))) return fail('rate_limited', 'daily_writes');

	const h = await hashOf(endpoint);
	const old = (await env.INVITES.get(`push:${h}`, 'json')) as PushRecord | null;
	const rec: PushRecord = { endpoint, p256dh, auth, timeZone, circleId, memberId, invites, lastFriday: old?.lastFriday, lastAnswerAt: old?.lastAnswerAt };
	await env.INVITES.put(`push:${h}`, JSON.stringify(rec), { expirationTtl: SUB_TTL_S });
	if (circleId) await env.INVITES.put(`pushc:${circleId}:${h}`, '1', { expirationTtl: SUB_TTL_S });
	if (old?.circleId && old.circleId !== circleId) await env.INVITES.delete(`pushc:${old.circleId}:${h}`);
	for (const id of invites) if (!old?.invites.includes(id)) await env.INVITES.put(`pushi:${id}:${h}`, '1', { expirationTtl: WATCH_INVITE_TTL_S });
	await wrote(env, now);
	return json({ ok: true });
}

function fromB64uSafe(s: string): Uint8Array | null {
	try {
		return fromB64u(s);
	} catch {
		return null;
	}
}

/** POST /api/push/unsub {endpoint} */
export async function unsubscribe(req: Request, env: Env): Promise<Response> {
	const b = await readJson(req);
	if (!b || typeof b !== 'object' || typeof b.endpoint !== 'string') return fail('bad_request');
	await forget(env, await hashOf(b.endpoint));
	return json({ ok: true });
}

async function forget(env: Env, h: string): Promise<void> {
	const rec = (await env.INVITES.get(`push:${h}`, 'json')) as PushRecord | null;
	await env.INVITES.delete(`push:${h}`);
	if (rec?.circleId) await env.INVITES.delete(`pushc:${rec.circleId}:${h}`);
	for (const id of rec?.invites ?? []) await env.INVITES.delete(`pushi:${id}:${h}`);
}

// ---------------------------------------------------------------- triggers
async function watchers(env: Env, prefix: string): Promise<string[]> {
	const list = await env.INVITES.list({ prefix });
	return list.keys.map((k) => k.name.slice(prefix.length));
}

/** Someone wrote to a family page: tell the phones watching it, except the writer's own. */
export async function notifyAnswer(env: Env, circleId: string, writerMemberId: string, origin: string, now = Date.now()): Promise<number> {
	let sent = 0;
	for (const h of await watchers(env, `pushc:${circleId}:`)) {
		const rec = (await env.INVITES.get(`push:${h}`, 'json')) as PushRecord | null;
		if (!rec || rec.circleId !== circleId || rec.memberId === writerMemberId) continue;
		if (rec.lastAnswerAt && now - rec.lastAnswerAt < ANSWER_GAP_MS) continue;
		const r = await sendPush(env, rec, 'answer', origin, now);
		if (r === 'gone') await forget(env, h);
		else if (r === 'ok') {
			sent++;
			await env.INVITES.put(`push:${h}`, JSON.stringify({ ...rec, lastAnswerAt: now }), { expirationTtl: SUB_TTL_S });
		}
	}
	return sent;
}

/** A pick-a-time link was picked: tell the phone that shared it. */
export async function notifyPicked(env: Env, inviteId: string, origin: string, now = Date.now()): Promise<number> {
	let sent = 0;
	for (const h of await watchers(env, `pushi:${inviteId}:`)) {
		const rec = (await env.INVITES.get(`push:${h}`, 'json')) as PushRecord | null;
		if (!rec) continue;
		const r = await sendPush(env, rec, 'picked', origin, now);
		if (r === 'gone') await forget(env, h);
		else if (r === 'ok') sent++;
	}
	return sent;
}

/** The local weekday (0 = Sunday), hour and date in a time zone. */
export function localNow(timeZone: string, now: number): { weekday: number; hour: number; day: string } {
	const parts = Object.fromEntries(
		new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short', hour: 'numeric', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit' })
			.formatToParts(new Date(now))
			.map((p) => [p.type, p.value])
	);
	const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday);
	return { weekday, hour: Number(parts.hour), day: `${parts.year}-${parts.month}-${parts.day}` };
}

/** Hourly: Friday 18:00 in each phone's own time zone, once. */
export async function fridayReminders(env: Env, origin: string, now = Date.now()): Promise<number> {
	let sent = 0;
	for (const h of await watchers(env, 'push:')) {
		const rec = (await env.INVITES.get(`push:${h}`, 'json')) as PushRecord | null;
		if (!rec) continue;
		const t = localNow(rec.timeZone, now);
		if (t.weekday !== 5 || t.hour < FRIDAY_HOUR || t.hour > FRIDAY_HOUR + 2 || rec.lastFriday === t.day) continue;
		const r = await sendPush(env, rec, 'weekend', origin, now);
		if (r === 'gone') await forget(env, h);
		else if (r === 'ok') {
			sent++;
			await env.INVITES.put(`push:${h}`, JSON.stringify({ ...rec, lastFriday: t.day }), { expirationTtl: SUB_TTL_S });
		}
	}
	return sent;
}
