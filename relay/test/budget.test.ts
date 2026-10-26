import { beforeEach, describe, expect, it, vi } from 'vitest';
import ICAL from 'ical.js';
import { audioUsd, Ledger, sparkUsd } from '../src/budget.ts';
import { ClientLimiter, deviceOf, resetAllLimits, VoiceLimiter } from '../src/ratelimit.ts';
import { busyFromIcs } from '../src/ical.ts';
import { route } from '../src/index.ts';
import { makeEnv, MemoryKV, post } from './helpers.ts';

beforeEach(() => resetAllLimits());

describe('cost estimates', () => {
	it('prices tokens and audio', () => {
		expect(sparkUsd({ input_tokens: 1_000_000, output_tokens: 1_000_000 })).toBeCloseTo(5.5);
		expect(audioUsd(3_600_000)).toBeCloseTo(0.18);
	});
});

describe('Ledger', () => {
	it('shares totals between isolates through KV, each writing its own key', async () => {
		const kv = new MemoryKV();
		const a = new Ledger();
		const b = new Ledger();
		const t = Date.parse('2026-11-02T10:00:00Z');
		await a.add(kv as unknown as KVNamespace, { usd: 0.3 }, t);
		await b.add(kv as unknown as KVNamespace, { usd: 0.2, weave: 0.2 }, t);
		expect(kv.store.size).toBe(2);
		const seen = await a.totals(kv as unknown as KVNamespace, t);
		expect(seen.usd).toBeCloseTo(0.5);
		expect(seen.weave).toBeCloseTo(0.2);
	});

	it('writes small amounts only now and then, and starts fresh each UTC day', async () => {
		const kv = new MemoryKV();
		const l = new Ledger();
		const t = Date.parse('2026-11-02T10:00:00Z');
		for (let i = 0; i < 50; i++) await l.add(kv as unknown as KVNamespace, { usd: 0.001 }, t + i * 1000);
		expect(kv.writes).toBe(0);
		await l.add(kv as unknown as KVNamespace, { usd: 0.001 }, t + 11 * 60_000);
		expect(kv.writes).toBe(1);
		expect((await l.totals(kv as unknown as KVNamespace, Date.parse('2026-11-03T00:00:01Z'))).usd).toBe(0);
	});

	it('keeps working when KV fails', async () => {
		const kv = { list: vi.fn(async () => { throw new Error('down'); }), put: vi.fn(async () => { throw new Error('down'); }) };
		const l = new Ledger();
		await l.add(kv as unknown as KVNamespace, { usd: 1 });
		expect((await l.totals(kv as unknown as KVNamespace)).usd).toBe(1);
	});
});

describe('voice limits', () => {
	const req = (q: string, headers: Record<string, string> = {}) =>
		new Request(`https://kizuna.test/api/asr?${q}`, { headers: { 'cf-connecting-ip': '203.0.113.9', ...headers } });

	it('reads the device id from the header or the query', () => {
		expect(deviceOf(req('device=abc-1'))).toBe('abc-1');
		expect(deviceOf(req('device=x', { 'x-kizuna-device': 'hdr' }))).toBe('hdr');
		expect(deviceOf(req('device=a<b>'))).toBe('ab');
	});

	it('gives each phone its own bucket behind one IP', () => {
		const v = new VoiceLimiter(new ClientLimiter({ capacity: 1, refillPerMinute: 0.001, daily: 10 }));
		expect(v.allow(req('device=a'))).toBe(true);
		expect(v.allow(req('device=a'))).toBe(false);
		expect(v.allow(req('device=b'))).toBe(true);
	});

	it('charges one token for a socket and its WAV fallback, and an id works twice at most', () => {
		const v = new VoiceLimiter(new ClientLimiter({ capacity: 1, refillPerMinute: 0.001, daily: 10 }));
		expect(v.allow(req('device=a&session=s1'))).toBe(true);
		expect(v.allow(req('device=a&session=s1'))).toBe(true);
		expect(v.allow(req('device=a&session=s1'))).toBe(false);
		expect(v.allow(req('device=a&session=s2'))).toBe(false);
	});

	it('refuses voice once the day budget is spent', async () => {
		const env = { ...makeEnv(), DAILY_BUDGET_USD: '0' };
		const wav = new Uint8Array(64);
		wav.set(new TextEncoder().encode('RIFF'), 0);
		wav.set(new TextEncoder().encode('WAVE'), 8);
		const res = await route(new Request('https://kizuna.test/api/transcribe', { method: 'POST', body: wav }), env);
		expect(res.status).toBe(429);
		expect(await res.json()).toMatchObject({ detail: 'daily_budget' });
		const ws = await route(new Request('https://kizuna.test/api/asr', { headers: { upgrade: 'websocket' } }), env);
		expect(ws.status).toBe(429);
	});
});

describe('invite writes', () => {
	const invite = {
		fromName: 'Aarav',
		title: 'Catch up',
		timeZone: 'Asia/Kolkata',
		slots: [
			{ start: '2027-01-09T10:00:00+05:30', end: '2027-01-09T11:00:00+05:30', label: 'a' },
			{ start: '2027-01-10T10:00:00+05:30', end: '2027-01-10T11:00:00+05:30', label: 'b' }
		]
	};

	it('allows about one new invite a minute per phone', async () => {
		const env = makeEnv();
		const codes = [];
		for (let i = 0; i < 3; i++) codes.push((await route(post('/api/invite', invite), env)).status);
		expect(codes).toEqual([201, 201, 429]);
	});

	it('stops writing once the daily write cap is reached', async () => {
		const env = { ...makeEnv(), KV_WRITES_PER_DAY: '1' };
		expect((await route(post('/api/invite', invite), env)).status).toBe(201);
		const res = await route(post('/api/invite', invite, { 'x-kizuna-device': 'other' }), env);
		expect(await res.json()).toMatchObject({ error: 'rate_limited', detail: 'daily_writes' });
	});

	it('refuses a time that has passed and skips writing an unchanged pick', async () => {
		const env = makeEnv();
		const past = { ...invite, slots: [{ start: '2020-01-01T10:00:00Z', end: '2020-01-01T11:00:00Z', label: 'old' }, invite.slots[0]] };
		const { id } = (await (await route(post('/api/invite', past), env)).json()) as any;
		expect((await route(post(`/api/invite/${id}/pick`, { index: 0 }), env)).status).toBe(400);
		expect((await route(post(`/api/invite/${id}/pick`, { index: 1 }), env)).status).toBe(200);
		const writes = env.kv.writes;
		expect((await route(post(`/api/invite/${id}/pick`, { index: 1 }), env)).status).toBe(200);
		expect(env.kv.writes).toBe(writes);
	});
});

describe('calendar time zones', () => {
	it('does not leave zones from a calendar in the global registry', () => {
		const ics = [
			'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:x',
			'BEGIN:VTIMEZONE', 'TZID:Made/Up', 'BEGIN:STANDARD', 'DTSTART:19700101T000000', 'TZOFFSETFROM:+0300', 'TZOFFSETTO:+0300', 'END:STANDARD', 'END:VTIMEZONE',
			'BEGIN:VEVENT', 'UID:1', 'DTSTART;TZID=Made/Up:20261102T100000', 'DTEND;TZID=Made/Up:20261102T110000', 'END:VEVENT',
			'END:VCALENDAR'
		].join('\r\n');
		const busy = busyFromIcs(ics, Date.parse('2026-11-01T00:00:00Z'), Date.parse('2026-11-05T00:00:00Z'));
		expect(busy).toEqual([{ start: '2026-11-02T07:00:00.000Z', end: '2026-11-02T08:00:00.000Z' }]);
		expect(ICAL.TimezoneService.has('Made/Up')).toBe(false);
	});
});
