import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Slot } from '@kizuna/shared';
import { db, defaultSettings } from '../db.ts';
import { isoWithOffset } from './days.ts';
import { pickSpread } from '@kizuna/shared';
import { deviceTimeZone } from './days.ts';
import { busyTimes, checkCalendar, clearBusyCache, createInvite, isCalendarLink, findFreeSlots, googleCalendarLink, icsFile, suggestSlots, utcStamp } from './time.ts';
import { mockRelay, resetDb, setOffline } from './testing.ts';

const NOW = new Date(2026, 9, 26, 10, 0); // Monday
const slot: Slot = { start: '2026-10-29T18:30:00+05:30', end: '2026-10-29T19:30:00+05:30', label: 'Thu 29 Oct, 18:30 to 19:30' };

beforeEach(async () => {
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(NOW);
	setOffline(false);
	clearBusyCache();
	await resetDb();
});
afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

describe('calendar links', () => {
	it('builds a Google Calendar template link in UTC', () => {
		const url = new URL(googleCalendarLink(slot, 'Catch up with Aarav'));
		expect(url.origin + url.pathname).toBe('https://calendar.google.com/calendar/render');
		expect(url.searchParams.get('action')).toBe('TEMPLATE');
		expect(url.searchParams.get('text')).toBe('Catch up with Aarav');
		expect(url.searchParams.get('dates')).toBe('20261029T130000Z/20261029T140000Z');
	});

	it('gives a .ics file built by the shared builder, with escaping', async () => {
		const blob = icsFile(slot, 'Dinner; Kabir, Meera\\ and me');
		expect(blob.type).toBe('text/calendar;charset=utf-8');
		const text = await blob.text();
		expect(text).toMatch(/^BEGIN:VCALENDAR\r\n/);
		expect(text).toContain(`DTSTAMP:${utcStamp(NOW)}\r\n`);
		expect(text).toContain('DTSTART:20261029T130000Z\r\n');
		expect(text).toContain('SUMMARY:Dinner\\; Kabir\\, Meera\\\\ and me\r\n');
	});
});

describe('free slots', () => {
	const freeHours = defaultSettings().freeHours;
	it('finds slots in free windows, not in the past, avoiding busy times', () => {
		const busy = [{ start: isoWithOffset(new Date(2026, 9, 26, 18, 0)), end: isoWithOffset(new Date(2026, 9, 26, 20, 0)) }];
		const timeZone = deviceTimeZone();
		const s = findFreeSlots({ now: NOW, timeZone, freeHours, busy, from: '2026-10-26', to: '2026-10-27', durationMinutes: 60 });
		expect(pickSpread(s, 2).map((x) => x.label)).toEqual(['Mon 26 Oct, 20:00 to 21:00', 'Tue 27 Oct, 18:30 to 19:30']);
		const late = findFreeSlots({ now: new Date(2026, 9, 26, 20, 50), timeZone, freeHours, busy: [], from: '2026-10-26', to: '2026-10-26', durationMinutes: 60 });
		expect(late).toEqual([]);
	});
});

describe('suggestSlots', () => {
	it('asks the plan task with busy times from the iCal link, cached for 30 minutes', async () => {
		await db.settings.put({ ...defaultSettings(), icalUrl: 'https://cal.example/private.ics' });
		const busy = [{ start: '2026-10-26T13:00:00Z', end: '2026-10-26T14:00:00Z' }];
		const relay = mockRelay(
			(task, input) => {
				expect(task).toBe('plan');
				expect(input.busy).toEqual(busy);
				expect(input.request).toBe('next weekend, not Sunday');
				expect(input.durationMinutes).toBe(60);
				expect(input.timeZone).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
				expect(input.now).toBe(isoWithOffset(NOW));
				return { slots: [slot, slot, slot], note: 'Saturday works.' };
			},
			(path, body) => {
				expect(path).toBe('/api/ical');
				expect(body.url).toBe('https://cal.example/private.ics');
				return { ok: true, busy };
			}
		);
		const r = await suggestSlots(' next weekend, not Sunday ');
		expect(r).toEqual({ slots: [slot, slot], note: 'Saturday works.' });
		await suggestSlots('next weekend, not Sunday');
		expect(relay.calls.filter((c) => c.path === '/api/ical')).toHaveLength(1);
		vi.setSystemTime(new Date(NOW.getTime() + 31 * 60_000));
		await suggestSlots('next weekend, not Sunday');
		expect(relay.calls.filter((c) => c.path === '/api/ical')).toHaveLength(2);
	});

	it('falls back to local slots when the plan call fails', async () => {
		mockRelay(() => {
			throw new Error('model down');
		});
		const r = await suggestSlots('next weekend');
		expect(r.slots).toHaveLength(2);
		expect(r.note).toBeNull();
	});

	it('falls back to free hours offline', async () => {
		setOffline(true);
		const r = await suggestSlots();
		expect(r.slots).toHaveLength(2);
		expect(r.slots[0].start.slice(0, 10)).not.toBe(r.slots[1].start.slice(0, 10));
		expect(new Date(r.slots[0].start).getTime()).toBeGreaterThan(NOW.getTime());
		expect(r.note).toBeNull();
		expect((await suggestSlots('Saturday')).note).toBeNull();
	});

	it('falls back when the plan task fails', async () => {
		mockRelay(() => {
			throw new Error('down');
		});
		expect((await suggestSlots()).slots).toHaveLength(2);
	});
});

describe('createInvite', () => {
	it('posts the invite with the first name and returns a full url', async () => {
		await db.settings.put({ ...defaultSettings(), myName: 'Aarav Mehta' });
		const relay = mockRelay(
			() => null,
			(_path, body) => {
				expect(body).toMatchObject({ fromName: 'Aarav', title: 'Catch up with Aarav', slots: [slot] });
				return { ok: true, id: 'x1', url: '/p/x1' };
			}
		);
		vi.stubGlobal('location', { origin: 'https://kizuna.example' });
		expect(await createInvite('kabir', [slot])).toBe('https://kizuna.example/p/x1');
		expect(relay.calls[0].path).toBe('/api/invite');
	});
});

describe('the calendar lookup', () => {
	it('remembers a failure for a few minutes, so Today and Find a time do not each wait again', async () => {
		await db.settings.put({ ...defaultSettings(), icalUrl: 'https://cal.example/broken.ics' });
		const relay = mockRelay(
			() => ({ slots: [] }),
			() => {
				throw new Error('500');
			}
		);
		expect(await busyTimes()).toEqual([]);
		expect(await busyTimes()).toEqual([]);
		await suggestSlots();
		expect(relay.calls.filter((c) => c.path === '/api/ical')).toHaveLength(1);
		vi.setSystemTime(new Date(NOW.getTime() + 6 * 60_000));
		await busyTimes();
		expect(relay.calls.filter((c) => c.path === '/api/ical')).toHaveLength(2);
	});

	it('asks once when several callers want it at the same moment', async () => {
		await db.settings.put({ ...defaultSettings(), icalUrl: 'https://cal.example/a.ics' });
		const busy = [{ start: '2026-10-26T13:00:00Z', end: '2026-10-26T14:00:00Z' }];
		const relay = mockRelay(() => ({}), () => ({ ok: true, busy }));
		const all = await Promise.all([busyTimes(), busyTimes(), busyTimes()]);
		expect(all).toEqual([busy, busy, busy]);
		expect(relay.calls.filter((c) => c.path === '/api/ical')).toHaveLength(1);
	});

	it('gives up on a calendar that never answers within a few seconds', async () => {
		vi.useRealTimers();
		await db.settings.put({ ...defaultSettings(), icalUrl: 'https://cal.example/slow.ics' });
		vi.stubGlobal(
			'fetch',
			vi.fn((_url: string, init?: RequestInit) => new Promise((_, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))))
		);
		const t0 = Date.now();
		expect(await busyTimes()).toEqual([]);
		expect(Date.now() - t0).toBeLessThan(7_000);
	}, 10_000);

	it('checks a link for Settings', async () => {
		mockRelay(() => ({}), (_path, body) => {
			if (String(body.url).includes('bad')) throw new Error('404');
			return { ok: true, busy: [] };
		});
		expect(await checkCalendar('https://cal.example/good.ics')).toBe('ok');
		expect(await checkCalendar('https://cal.example/bad.ics')).toBe('failed');
		setOffline(true);
		expect(await checkCalendar('https://cal.example/good.ics')).toBe('offline');
	});

	it('knows what could be a calendar link', () => {
		expect(isCalendarLink('https://calendar.google.com/calendar/ical/x%40gmail.com/private-abc/basic.ics')).toBe(true);
		expect(isCalendarLink('webcal://p12-caldav.icloud.com/published/2/abc')).toBe(true);
		expect(isCalendarLink('not a url')).toBe(false);
		expect(isCalendarLink('calendar.google.com/basic.ics')).toBe(false);
		expect(isCalendarLink('https://localhost')).toBe(false);
	});
});
