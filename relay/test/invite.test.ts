import { beforeEach, describe, expect, it } from 'vitest';
import { get, makeEnv, MemoryKV, post } from './helpers.ts';
import { route } from '../src/index.ts';
import { resetAllLimits } from '../src/ratelimit.ts';
import { INVITE_TTL_S, parseInviteRequest } from '../src/invite.ts';
import { googleCalendarUrl, icsFor } from '../src/page.ts';

const invite = {
	fromName: 'Aarav Mehta',
	title: 'Catch up with Aarav',
	timeZone: 'Asia/Kolkata',
	slots: [
		{ start: '2027-01-09T10:00:00+05:30', end: '2027-01-09T11:00:00+05:30', label: 'Sat 9 Jan, 10:00 to 11:00' },
		{ start: '2027-01-12T18:30:00+05:30', end: '2027-01-12T19:30:00+05:30', label: 'Tue 12 Jan, 18:30 to 19:30' }
	]
};

beforeEach(() => resetAllLimits());

async function create(env = makeEnv(), body: unknown = invite, headers = {}) {
	const res = await route(post('/api/invite', body, headers), env);
	return { res, data: (await res.json()) as any, env };
}

describe('invites', () => {
	it('creates an invite with a short id, first name only, 7 day TTL', async () => {
		const { res, data, env } = await create();
		expect(res.status).toBe(201);
		expect(data.ok).toBe(true);
		expect(data.id).toMatch(/^[a-z2-9]{10}$/);
		expect(data.url).toBe(`https://kizuna.test/p/${data.id}`);
		const stored = env.kv.store.get(`inv:${data.id}`)!;
		expect(JSON.parse(stored.value)).toEqual({ fromName: 'Aarav', title: invite.title, slots: invite.slots, timeZone: 'Asia/Kolkata', pickedIndex: null, expiresAt: expect.any(String) });
		expect(stored.expires! - Date.now()).toBeGreaterThan((INVITE_TTL_S - 5) * 1000);
	});

	it('uses the app origin for links in local dev', async () => {
		const env = makeEnv();
		const req = new Request('http://localhost:8787/api/invite', { method: 'POST', headers: { origin: 'http://localhost:5173' }, body: JSON.stringify(invite) });
		const data = (await (await route(req, env)).json()) as any;
		expect(data.url).toBe(`http://localhost:5173/p/${data.id}`);
	});

	it('validates the request', () => {
		expect(parseInviteRequest({ ...invite, slots: [] })).toBeNull();
		expect(parseInviteRequest({ ...invite, slots: [...invite.slots, ...invite.slots] })).toBeNull();
		expect(parseInviteRequest({ ...invite, timeZone: 'Nowhere/Land' })).toBeNull();
		expect(parseInviteRequest({ ...invite, fromName: '   ' })).toBeNull();
		expect(parseInviteRequest({ ...invite, slots: [{ start: 'x', end: 'y', label: '' }] })).toBeNull();
		expect(parseInviteRequest({ ...invite, slots: [{ ...invite.slots[0], end: invite.slots[0].start }] })).toBeNull();
		expect(parseInviteRequest({ ...invite, title: 'a\nb' })!.title).toBe('a b');
	});

	it('gets and picks', async () => {
		const { data, env } = await create();
		const state = (await (await route(get(`/api/invite/${data.id}`), env)).json()) as any;
		expect(state).toMatchObject({ id: data.id, fromName: 'Aarav', pickedIndex: null });
		const bad = await route(post(`/api/invite/${data.id}/pick`, { index: 5 }), env);
		expect(bad.status).toBe(400);
		const picked = (await (await route(post(`/api/invite/${data.id}/pick`, { index: 1 }), env)).json()) as any;
		expect(picked.pickedIndex).toBe(1);
		const again = (await (await route(get(`/api/invite/${data.id}`), env)).json()) as any;
		expect(again.pickedIndex).toBe(1);
		expect(again.expiresAt).toBe(state.expiresAt); // pick keeps the original expiry
	});

	it('expires after 7 days', async () => {
		const kv = new MemoryKV();
		const env = makeEnv(kv);
		const { data } = await create(env);
		kv.now = () => Date.now() + INVITE_TTL_S * 1000 + 1000;
		expect((await route(get(`/api/invite/${data.id}`), env)).status).toBe(404);
		expect((await route(post(`/api/invite/${data.id}/pick`, { index: 0 }), env)).status).toBe(404);
		const page = await route(get(`/p/${data.id}`), env);
		expect(page.status).toBe(404);
		expect(await page.text()).toContain('This invite has ended.');
	});

	it('treats unknown and malformed ids as gone', async () => {
		const env = makeEnv();
		expect((await route(get('/api/invite/abcdefghjk'), env)).status).toBe(404);
		expect((await route(get('/api/invite/bad%20id'), env)).status).toBe(404);
		expect((await route(get('/p/<script>'), env)).status).toBe(404);
	});
});

describe('pick page', () => {
	it('renders the invite with CSP, escaping and the slots', async () => {
		const evil = { ...invite, fromName: '<img src=x onerror=alert(1)>', title: 'Tea & "talk" </script>' };
		const { data, env } = await create(makeEnv(), evil);
		const res = await route(get(`/p/${data.id}`), env);
		expect(res.status).toBe(200);
		const csp = res.headers.get('content-security-policy')!;
		expect(csp).toMatch(/script-src 'nonce-[^']+'/);
		expect(csp).toContain("default-src 'none'");
		expect(csp).toContain("frame-ancestors 'none'");
		const html = await res.text();
		const n = /script-src 'nonce-([^']+)'/.exec(csp)![1];
		expect(html).toContain(`<script nonce="${n}">`);
		expect(html).not.toContain('<img src=x');
		expect(html).toContain('&lt;img wants to catch up.');
		expect(html).toContain('Pick a time that works.');
		expect(html).toContain('Sat 9 Jan');
		expect(html).toContain('data-start="2027-01-09T10:00:00+05:30"');
		expect(html).not.toMatch(/<(link|img|iframe)\b/);
		expect(html).not.toMatch(/https?:\/\/(?!calendar\.google)/);
	});

	it('the normal greeting reads well', async () => {
		const { data, env } = await create();
		const html = await (await route(get(`/p/${data.id}`), env)).text();
		expect(html).toContain('Aarav wants to catch up.');
		expect(html).toContain(`action="/p/${data.id}"`);
	});

	it('form post picks and redirects, then shows calendar buttons', async () => {
		const { data, env } = await create();
		const form = new URLSearchParams({ index: '1' });
		const res = await route(new Request(`https://kizuna.test/p/${data.id}`, { method: 'POST', body: form, headers: { 'content-type': 'application/x-www-form-urlencoded' } }), env);
		expect(res.status).toBe(303);
		expect(res.headers.get('location')).toBe(`/p/${data.id}`);
		const html = await (await route(get(`/p/${data.id}`), env)).text();
		expect(html).toContain('Add to Google Calendar');
		expect(html).toContain('Download .ics');
		expect(html).toContain('Aarav will see your pick.');
		expect(html).toContain('Tue 12 Jan');
		expect(html).toContain('dates=20270112T130000Z%2F20270112T140000Z');
		const change = await (await route(get(`/p/${data.id}?change=1`), env)).text();
		expect(change).toContain('Pick a time that works.');
	});

	it('serves an .ics for the pick', async () => {
		const { data, env } = await create(makeEnv(), { ...invite, title: 'Chai, cake; and "us"' });
		await route(post(`/api/invite/${data.id}/pick`, { index: 0 }), env);
		const res = await route(get(`/p/${data.id}/invite.ics`), env);
		expect(res.headers.get('content-type')).toContain('text/calendar');
		const ics = await res.text();
		expect(ics).toContain('DTSTART:20270109T043000Z\r\n');
		expect(ics).toContain('DTEND:20270109T053000Z\r\n');
		expect(ics).toContain('SUMMARY:Chai\\, cake\\; and "us"\r\n');
		expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
	});

	it('builds calendar links and ics directly', () => {
		const url = new URL(googleCalendarUrl('Catch up', invite.slots[0], 'x'));
		expect(url.searchParams.get('dates')).toBe('20270109T043000Z/20270109T053000Z');
		expect(url.searchParams.get('action')).toBe('TEMPLATE');
		const ics = icsFor('abc', { ...invite, fromName: 'Aarav', pickedIndex: 0, expiresAt: '' }, 1, Date.parse('2027-01-01T00:00:00Z'));
		expect(ics).toContain('UID:abc-1@kizuna');
		expect(ics).toContain('DTSTAMP:20270101T000000Z');
	});
});
