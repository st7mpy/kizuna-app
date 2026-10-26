import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Slot } from '@kizuna/shared';
import { db, defaultSettings } from '../db.ts';
import { isoWithOffset } from './days.ts';
import { clearBusyCache, createInvite, googleCalendarLink, icsFile, icsText, localFreeSlots, pickTwo, suggestSlots, utcStamp } from './time.ts';
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

	it('writes a proper .ics with CRLF, UID, DTSTAMP and escaping', async () => {
		const text = icsText(slot, 'Dinner; Kabir, Meera\\ and me', 'abc');
		const lines = text.split('\r\n');
		expect(text.endsWith('\r\n')).toBe(true);
		expect(text.replace(/\r\n/g, '')).not.toMatch(/\n/);
		expect(lines[0]).toBe('BEGIN:VCALENDAR');
		expect(lines).toContain('VERSION:2.0');
		expect(lines).toContain('UID:abc@kizuna');
		expect(lines).toContain(`DTSTAMP:${utcStamp(NOW)}`);
		expect(lines).toContain('DTSTART:20261029T130000Z');
		expect(lines).toContain('DTEND:20261029T140000Z');
		expect(lines).toContain('SUMMARY:Dinner\; Kabir\\, Meera\\\\ and me');
		expect(lines.at(-2)).toBe('END:VCALENDAR');
		const blob = icsFile(slot, 'Catch up');
		expect(blob.type).toBe('text/calendar;charset=utf-8');
		expect(await blob.text()).toMatch(/^BEGIN:VCALENDAR\r\n/);
	});

	it('folds long lines', () => {
		const text = icsText(slot, 'x'.repeat(200), 'u');
		for (const l of text.split('\r\n')) expect(new TextEncoder().encode(l).length).toBeLessThanOrEqual(75);
		expect(text).toMatch(/\r\n x/);
	});
});

describe('local slots', () => {
	const freeHours = defaultSettings().freeHours;
	it('finds slots in free windows, not in the past, avoiding busy times', () => {
		const busy = [{ start: isoWithOffset(new Date(2026, 9, 26, 18, 0)), end: isoWithOffset(new Date(2026, 9, 26, 20, 0)) }];
		const s = localFreeSlots({ now: NOW, freeHours, busy, from: '2026-10-26', to: '2026-10-27', durationMinutes: 60 });
		expect(s.map((x) => x.label)).toEqual(['Mon 26 Oct, 20:00 to 21:00', 'Tue 27 Oct, 18:30 to 19:30']);
		const late = localFreeSlots({ now: new Date(2026, 9, 26, 20, 50), freeHours, busy: [], from: '2026-10-26', to: '2026-10-26', durationMinutes: 60 });
		expect(late).toEqual([]);
	});
	it('picks two slots on different days when it can', () => {
		const mk = (d: string, h: string): Slot => ({ start: `${d}T${h}:00+05:30`, end: '', label: '' });
		expect(pickTwo([mk('2026-10-31', '10'), mk('2026-10-31', '16'), mk('2026-11-01', '10')]).map((s) => s.start.slice(0, 13))).toEqual(['2026-10-31T10', '2026-11-01T10']);
		expect(pickTwo([])).toEqual([]);
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

	it('falls back to free hours offline', async () => {
		setOffline(true);
		const r = await suggestSlots();
		expect(r.slots).toHaveLength(2);
		expect(r.slots[0].start.slice(0, 10)).not.toBe(r.slots[1].start.slice(0, 10));
		expect(new Date(r.slots[0].start).getTime()).toBeGreaterThan(NOW.getTime());
		expect(r.note).toBeNull();
		expect((await suggestSlots('Saturday')).note).toBe('Picked from your usual free hours.');
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
