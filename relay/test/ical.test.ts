import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { busyFromIcs, safeCalendarUrl } from '../src/ical.ts';
import { route } from '../src/index.ts';
import { resetAllLimits } from '../src/ratelimit.ts';
import { makeEnv, post } from './helpers.ts';
import ics from './fixtures/sample.ics?raw';

const from = '2026-11-02T00:00:00Z';
const to = '2026-11-12T00:00:00Z';

describe('busyFromIcs', () => {
	const busy = busyFromIcs(ics, Date.parse(from), Date.parse(to));

	it('expands the weekly event, skipping EXDATE and moving the exception', () => {
		expect(busy).toContainEqual({ start: '2026-11-02T04:30:00.000Z', end: '2026-11-02T05:00:00.000Z' }); // Mon 10:00 IST
		expect(busy.find((b) => b.start.startsWith('2026-11-04T04:30'))).toBeUndefined(); // EXDATE
		expect(busy).toContainEqual({ start: '2026-11-09T09:30:00.000Z', end: '2026-11-09T10:30:00.000Z' }); // moved to 15:00 IST
		expect(busy.find((b) => b.start.startsWith('2026-11-09T04:30'))).toBeUndefined();
		expect(busy).toContainEqual({ start: '2026-11-11T04:30:00.000Z', end: '2026-11-11T05:00:00.000Z' });
	});

	it('merges overlaps and skips free, cancelled and plain all-day items', () => {
		expect(busy).toContainEqual({ start: '2026-11-03T12:00:00.000Z', end: '2026-11-03T14:00:00.000Z' });
		expect(busy.find((b) => b.start.startsWith('2026-11-05'))).toBeUndefined();
		expect(busy.find((b) => b.start.startsWith('2026-11-06'))).toBeUndefined();
		expect(busy.find((b) => b.start.startsWith('2026-11-07'))).toBeUndefined();
		expect(busy.find((b) => b.start.startsWith('2026-11-08'))).toBeDefined(); // opaque all-day trip
	});

	it('returns busy times only, in order, within range', () => {
		for (const b of busy) {
			expect(Object.keys(b)).toEqual(['start', 'end']);
			expect(b.start >= from && b.end <= to).toBe(true);
		}
		expect([...busy].sort((a, b) => a.start.localeCompare(b.start))).toEqual(busy);
		expect(JSON.stringify(busy)).not.toContain('Secret');
	});

	it('clips to the range', () => {
		const b = busyFromIcs(ics, Date.parse('2026-11-03T12:30:00Z'), Date.parse('2026-11-03T13:00:00Z'));
		expect(b).toEqual([{ start: '2026-11-03T12:30:00.000Z', end: '2026-11-03T13:00:00.000Z' }]);
	});
});

describe('safeCalendarUrl', () => {
	it('accepts https and rewrites webcal', () => {
		expect(safeCalendarUrl('https://calendar.google.com/calendar/ical/x/basic.ics')?.href).toBe('https://calendar.google.com/calendar/ical/x/basic.ics');
		expect(safeCalendarUrl('webcal://p01-caldav.icloud.com/published/2/abc')?.protocol).toBe('https:');
	});
	it.each([
		'http://example.com/a.ics',
		'ftp://example.com/a.ics',
		'https://localhost/a.ics',
		'https://foo.localhost/a.ics',
		'https://127.0.0.1/a.ics',
		'https://10.1.2.3/a.ics',
		'https://192.168.1.1/a.ics',
		'https://172.20.0.1/a.ics',
		'https://169.254.169.254/latest',
		'https://[::1]/a.ics',
		'https://2130706433/a.ics',
		'https://user:pw@example.com/a.ics',
		'https://example.com:8443/a.ics',
		'https://printer.local/a.ics',
		'https://intranet/a.ics',
		'not a url'
	])('rejects %s', (u) => {
		expect(safeCalendarUrl(u)).toBeNull();
	});
});

describe('POST /api/ical', () => {
	let fetchMock: ReturnType<typeof vi.fn>;
	beforeEach(() => {
		resetAllLimits();
		fetchMock = vi.fn();
		vi.stubGlobal('fetch', fetchMock);
	});
	afterEach(() => vi.unstubAllGlobals());

	it('fetches and returns busy times', async () => {
		fetchMock.mockResolvedValueOnce(new Response(ics, { headers: { 'content-type': 'text/calendar' } }));
		const res = await route(post('/api/ical', { url: 'webcal://cal.example.com/me.ics', from, to }), makeEnv());
		const data = (await res.json()) as any;
		expect(data.ok).toBe(true);
		expect(data.busy.length).toBeGreaterThan(3);
		expect(fetchMock.mock.calls[0][0]).toBe('https://cal.example.com/me.ics');
		expect(fetchMock.mock.calls[0][1].redirect).toBe('manual');
	});

	it('refuses redirects to private hosts', async () => {
		fetchMock.mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: 'https://127.0.0.1/x' } }));
		const res = await route(post('/api/ical', { url: 'https://cal.example.com/me.ics', from, to }), makeEnv());
		expect(await res.json()).toMatchObject({ ok: false, error: 'fetch_failed' });
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it('caps size at 2 MB', async () => {
		fetchMock.mockResolvedValueOnce(new Response('x'.repeat(2 * 1024 * 1024 + 1)));
		const res = await route(post('/api/ical', { url: 'https://cal.example.com/me.ics', from, to }), makeEnv());
		expect(res.status).toBe(413);
	});

	it('rejects bad urls and ranges before fetching', async () => {
		expect((await route(post('/api/ical', { url: 'https://10.0.0.1/x', from, to }), makeEnv())).status).toBe(400);
		expect((await route(post('/api/ical', { url: 'https://cal.example.com/x', from: to, to: from }), makeEnv())).status).toBe(400);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('reports unparseable calendars', async () => {
		fetchMock.mockResolvedValueOnce(new Response('<html>login</html>'));
		const res = await route(post('/api/ical', { url: 'https://cal.example.com/me.ics', from, to }), makeEnv());
		expect(await res.json()).toMatchObject({ ok: false, error: 'parse_failed' });
	});
});
