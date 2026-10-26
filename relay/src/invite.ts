// Pick-a-time invites. Stored in KV for 7 days: first name, title, slots, time zone, pick.
import { icsText, isValidTimeZone, slotLabel, type InviteRequest, type InviteState, type Slot } from '@kizuna/shared';
import type { Env } from './env.ts';
import { fail, json, readBody } from './http.ts';
import { edgeAllow, limits } from './ratelimit.ts';
import { canWrite, wrote } from './budget.ts';

export const INVITE_TTL_S = 7 * 86_400;
const ID_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
export const ID_RE = /^[a-hjkmnp-z2-9]{10}$/;

export interface StoredInvite {
	fromName: string;
	title: string;
	slots: Slot[];
	timeZone: string;
	pickedIndex: number | null;
	expiresAt: string;
}

export function newInviteId(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(10));
	return Array.from(bytes, (b) => ID_ALPHABET[b % ID_ALPHABET.length]).join('');
}

function clean(s: unknown, max: number): string {
	return typeof s === 'string' ? s.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '';
}

/** Validates and trims an invite request; returns null if it can't be used. */
export function parseInviteRequest(raw: any): InviteRequest | null {
	if (!raw || typeof raw !== 'object') return null;
	const fromName = clean(raw.fromName, 40).split(' ')[0] ?? '';
	const title = clean(raw.title, 80);
	const timeZone = typeof raw.timeZone === 'string' ? raw.timeZone : '';
	if (!fromName || !title || !isValidTimeZone(timeZone)) return null;
	if (!Array.isArray(raw.slots) || raw.slots.length < 1 || raw.slots.length > 3) return null;
	const slots: Slot[] = [];
	for (const s of raw.slots) {
		const a = Date.parse(s?.start);
		const b = Date.parse(s?.end);
		if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a || b - a > 12 * 3_600_000) return null;
		if (typeof s.start !== 'string' || typeof s.end !== 'string' || s.start.length > 40 || s.end.length > 40) return null;
		slots.push({ start: s.start, end: s.end, label: clean(s.label, 60) || slotLabel(a, b, timeZone) });
	}
	return { fromName, title, slots, timeZone };
}

export async function loadInvite(env: Env, id: string, now = Date.now()): Promise<StoredInvite | null> {
	if (!ID_RE.test(id)) return null;
	const inv = await env.INVITES.get<StoredInvite>(`inv:${id}`, 'json');
	if (!inv || Date.parse(inv.expiresAt) <= now) return null;
	return inv;
}

export function inviteState(id: string, inv: StoredInvite): InviteState {
	return { id, fromName: inv.fromName, title: inv.title, slots: inv.slots, timeZone: inv.timeZone, pickedIndex: inv.pickedIndex, expiresAt: inv.expiresAt };
}

function publicOrigin(req: Request): string {
	const url = new URL(req.url);
	// In dev the app runs on Vite and proxies here; give links on the app's origin.
	const origin = req.headers.get('origin');
	if ((url.hostname === 'localhost' || url.hostname === '127.0.0.1') && origin && /^https?:\/\/[\w.-]+(:\d+)?$/.test(origin)) {
		return origin;
	}
	return url.origin;
}

export async function createInvite(req: Request, env: Env, now = Date.now()): Promise<Response> {
	if (!limits.inviteCreate.allow(req, now) || !(await edgeAllow(env.RL_INVITE, req))) return fail('rate_limited');
	if (!(await canWrite(env, now))) return fail('rate_limited', 'daily_writes');
	const bytes = await readBody(req, 8_000);
	if (!bytes) return fail('too_large');
	let raw: unknown;
	try {
		raw = JSON.parse(new TextDecoder().decode(bytes));
	} catch {
		return fail('bad_request');
	}
	const parsed = parseInviteRequest(raw);
	if (!parsed) return fail('bad_request', 'check name, title, 1 to 3 slots and time zone');
	const id = newInviteId();
	const stored: StoredInvite = { ...parsed, pickedIndex: null, expiresAt: new Date(now + INVITE_TTL_S * 1000).toISOString() };
	await env.INVITES.put(`inv:${id}`, JSON.stringify(stored), { expirationTtl: INVITE_TTL_S });
	await wrote(env, now);
	return json({ ok: true, id, url: `${publicOrigin(req)}/p/${id}` }, 201);
}

export async function getInvite(env: Env, id: string): Promise<Response> {
	const inv = await loadInvite(env, id);
	return inv ? json(inviteState(id, inv)) : fail('not_found');
}

/** Records a pick. Changing your mind is allowed until the invite expires. */
export async function savePick(env: Env, id: string, index: unknown, now = Date.now()): Promise<StoredInvite | 'not_found' | 'bad_index' | 'busy'> {
	const inv = await loadInvite(env, id, now);
	if (!inv) return 'not_found';
	if (typeof index !== 'number' || !Number.isInteger(index) || index < 0 || index >= inv.slots.length) return 'bad_index';
	if (Date.parse(inv.slots[index].start) <= now) return 'bad_index'; // that time has passed
	if (inv.pickedIndex === index) return inv; // nothing changed, no write
	if (!(await canWrite(env, now))) return 'busy';
	inv.pickedIndex = index;
	// Keep the original expiry; KV needs at least 60 s.
	const expiration = Math.max(Math.floor(Date.parse(inv.expiresAt) / 1000), Math.floor(now / 1000) + 61);
	await env.INVITES.put(`inv:${id}`, JSON.stringify(inv), { expiration });
	await wrote(env, now);
	return inv;
}

export async function pickInvite(req: Request, env: Env, id: string): Promise<Response> {
	if (!limits.invite.allow(req) || !(await edgeAllow(env.RL_INVITE, req))) return fail('rate_limited');
	const bytes = await readBody(req, 1_000);
	if (!bytes) return fail('too_large');
	let body: any;
	try {
		body = JSON.parse(new TextDecoder().decode(bytes));
	} catch {
		return fail('bad_request');
	}
	const r = await savePick(env, id, body?.index);
	if (r === 'not_found') return fail('not_found');
	if (r === 'bad_index') return fail('bad_request', 'index');
	if (r === 'busy') return fail('rate_limited', 'daily_writes');
	return json(inviteState(id, r));
}

/** The .ics for a picked slot (shared builder: escaping and line folding per RFC 5545). */
export function icsFor(id: string, inv: StoredInvite, index: number, now = Date.now()): string {
	const slot = inv.slots[index];
	return icsText({
		uid: `${id}-${index}@kizuna`,
		start: slot.start,
		end: slot.end,
		title: inv.title,
		description: `Picked on Kizuna. ${inv.fromName} can see your pick.`,
		now
	});
}
