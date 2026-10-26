// Kizuna map circles. The relay stores ciphertext only: one sealed entry per member, keyed
// circle:<id>:m:<memberId> (TTL 8 days), plus a small circle record circle:<id> (TTL 90 days,
// refreshed by writes). The key lives in the link's #fragment and never reaches this server.
import { CIRCLE_ID_RE, CIRCLE_LIMITS, MEMBER_ID_RE, randomId, type CircleState, type Sealed } from '@kizuna/shared';
import type { Env } from './env.ts';
import { fail, json, readBody } from './http.ts';
import { clientIp, edgeAllow, limits } from './ratelimit.ts';
import { canWrite, wrote } from './budget.ts';
import { publicOrigin } from './invite.ts';

const B64URL = /^[A-Za-z0-9_-]+$/;
/** Entries this small also ride in the key's metadata, so a read is one list call. */
const METADATA_MAX = 1000;
/** Refresh the circle record's TTL at most once a day. */
const TOUCH_MS = 86_400_000;
const MAX_BODY = Math.ceil((CIRCLE_LIMITS.maxSealedBytes * 4) / 3) + 200;

interface CircleRecord { createdAt: string; touchedAt: string }

const recordKey = (id: string) => `circle:${id}`;
const memberPrefix = (id: string) => `circle:${id}:m:`;
const memberKey = (id: string, memberId: string) => `${memberPrefix(id)}${memberId}`;

/** Checks a Sealed body: base64url fields, a 12-byte iv, ciphertext within the size cap. */
export function parseSealed(raw: any): Sealed | 'bad_request' | 'too_large' {
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return 'bad_request';
	const { iv, ct } = raw;
	if (typeof iv !== 'string' || typeof ct !== 'string' || !B64URL.test(iv) || !B64URL.test(ct)) return 'bad_request';
	if (iv.length !== 16) return 'bad_request'; // 12 bytes
	const ctBytes = Math.floor((ct.length * 3) / 4);
	if (ctBytes > CIRCLE_LIMITS.maxSealedBytes) return 'too_large';
	if (ctBytes < 17) return 'bad_request'; // the 16-byte tag plus something
	return { iv, ct };
}

async function writeAllowed(req: Request, env: Env, id: string): Promise<boolean> {
	const ip = clientIp(req);
	return limits.circleWriteIp.take(`ip:${ip}`) && limits.circleWrite.take(`${ip}|${id}`) && (await edgeAllow(env.RL_INVITE, req, id));
}

async function loadRecord(env: Env, id: string): Promise<CircleRecord | null> {
	return env.INVITES.get<CircleRecord>(recordKey(id), 'json');
}

async function memberIds(env: Env, id: string): Promise<{ name: string; metadata?: unknown }[]> {
	const r = await env.INVITES.list<Sealed>({ prefix: memberPrefix(id), limit: CIRCLE_LIMITS.maxMembers + 8 });
	return r.keys;
}

/** POST /api/circle -> { ok, id, url } */
export async function createCircle(req: Request, env: Env, now = Date.now()): Promise<Response> {
	if (!limits.circleCreate.allow(req, now) || !(await edgeAllow(env.RL_INVITE, req))) return fail('rate_limited');
	if (!(await canWrite(env, now))) return fail('rate_limited', 'daily_writes');
	if (!(await readBody(req, 1_000))) return fail('too_large');
	const id = randomId(16);
	const at = new Date(now).toISOString();
	const record: CircleRecord = { createdAt: at, touchedAt: at };
	await env.INVITES.put(recordKey(id), JSON.stringify(record), { expirationTtl: CIRCLE_LIMITS.circleTtlSeconds });
	await wrote(env, now);
	return json({ ok: true, id, url: `${publicOrigin(req)}/c/${id}` }, 201);
}

/** PUT /api/circle/:id/m/:memberId with a Sealed body. */
export async function putMember(req: Request, env: Env, id: string, memberId: string, now = Date.now()): Promise<Response> {
	if (!CIRCLE_ID_RE.test(id) || !MEMBER_ID_RE.test(memberId)) return fail('bad_request', 'id');
	if (!(await writeAllowed(req, env, id))) return fail('rate_limited');
	if (!(await canWrite(env, now))) return fail('rate_limited', 'daily_writes');
	const bytes = await readBody(req, MAX_BODY);
	if (!bytes) return fail('too_large');
	let raw: unknown;
	try {
		raw = JSON.parse(new TextDecoder().decode(bytes));
	} catch {
		return fail('bad_request');
	}
	const sealed = parseSealed(raw);
	if (sealed === 'too_large') return fail('too_large');
	if (sealed === 'bad_request') return fail('bad_request', 'sealed');
	const record = await loadRecord(env, id);
	if (!record) return fail('not_found');
	const keys = await memberIds(env, id);
	const key = memberKey(id, memberId);
	if (!keys.some((k) => k.name === key) && keys.length >= CIRCLE_LIMITS.maxMembers) return fail('bad_request', 'circle_full');

	const value = JSON.stringify(sealed);
	await env.INVITES.put(key, value, {
		expirationTtl: CIRCLE_LIMITS.entryTtlSeconds,
		...(value.length <= METADATA_MAX ? { metadata: sealed } : {})
	});
	await wrote(env, now);
	if (now - Date.parse(record.touchedAt) >= TOUCH_MS) {
		await env.INVITES.put(recordKey(id), JSON.stringify({ ...record, touchedAt: new Date(now).toISOString() }), {
			expirationTtl: CIRCLE_LIMITS.circleTtlSeconds
		});
		await wrote(env, now);
	}
	return json({ ok: true });
}

/** DELETE /api/circle/:id/m/:memberId (leave). */
export async function deleteMember(req: Request, env: Env, id: string, memberId: string, now = Date.now()): Promise<Response> {
	if (!CIRCLE_ID_RE.test(id) || !MEMBER_ID_RE.test(memberId)) return fail('bad_request', 'id');
	if (!(await writeAllowed(req, env, id))) return fail('rate_limited');
	if (!(await canWrite(env, now))) return fail('rate_limited', 'daily_writes');
	await env.INVITES.delete(memberKey(id, memberId));
	await wrote(env, now);
	return json({ ok: true });
}

/** GET /api/circle/:id -> CircleState (ciphertexts only). One list call, plus a get for any big entry. */
export async function getCircle(req: Request, env: Env, id: string): Promise<Response> {
	if (!CIRCLE_ID_RE.test(id)) return fail('not_found');
	if (!limits.circleRead.take(`${clientIp(req)}|${id}`)) return fail('rate_limited');
	const record = await loadRecord(env, id);
	if (!record) return fail('not_found');
	const keys = (await memberIds(env, id)).slice(0, CIRCLE_LIMITS.maxMembers);
	const prefix = memberPrefix(id);
	const members: CircleState['members'] = [];
	for (const k of keys) {
		const memberId = k.name.slice(prefix.length);
		let sealed = parseSealed(k.metadata);
		if (typeof sealed === 'string') sealed = parseSealed(await env.INVITES.get(k.name, 'json'));
		if (typeof sealed !== 'string') members.push({ memberId, iv: sealed.iv, ct: sealed.ct });
	}
	const state: CircleState = { ok: true, id, members };
	return json(state);
}
