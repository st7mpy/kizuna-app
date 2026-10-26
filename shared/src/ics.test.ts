import { describe, expect, it } from 'vitest';
import { googleCalendarLink, icsEscape, icsFold, icsText, utcStamp } from './ics.ts';

const slot = { start: '2026-10-29T18:30:00+05:30', end: '2026-10-29T19:30:00+05:30' };

describe('ics', () => {
	it('escapes backslash, semicolon, comma and every kind of newline', () => {
		expect(icsEscape('a\\b;c,d\ne\r\nf\rg')).toBe('a\\\\b\\;c\\,d\\ne\\nf\\ng');
	});

	it('writes one event with CRLF, UID, DTSTAMP and escaped text', () => {
		const text = icsText({ uid: 'abc@kizuna', ...slot, title: 'Dinner; Kabir, Meera\\ and me', description: 'Line one\nLine two', now: Date.parse('2026-10-26T04:30:00Z') });
		const lines = text.split('\r\n');
		expect(text.endsWith('\r\n')).toBe(true);
		expect(text.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
		expect(lines[0]).toBe('BEGIN:VCALENDAR');
		expect(lines).toContain('UID:abc@kizuna');
		expect(lines).toContain('DTSTAMP:20261026T043000Z');
		expect(lines).toContain('DTSTART:20261029T130000Z');
		expect(lines).toContain('DTEND:20261029T140000Z');
		expect(lines).toContain(String.raw`SUMMARY:Dinner\; Kabir\, Meera\\ and me`);
		expect(lines).toContain(String.raw`DESCRIPTION:Line one\nLine two`);
		expect(lines.at(-2)).toBe('END:VCALENDAR');
	});

	it('folds long lines at 75 octets without splitting characters', () => {
		const text = icsText({ uid: 'u', ...slot, title: 'x'.repeat(200) + 'नमस्ते'.repeat(20) });
		for (const l of text.split('\r\n')) expect(new TextEncoder().encode(l).length).toBeLessThanOrEqual(75);
		expect(text).toMatch(/\r\n x/);
		expect(icsFold('short')).toBe('short');
		const unfolded = text.replace(/\r\n /g, '');
		expect(unfolded).toContain('नमस्ते'.repeat(20));
	});

	it('builds a Google Calendar template link in UTC', () => {
		const url = new URL(googleCalendarLink(slot, 'Catch up', 'details'));
		expect(url.searchParams.get('dates')).toBe(`${utcStamp(slot.start)}/${utcStamp(slot.end)}`);
		expect(url.searchParams.get('details')).toBe('details');
		expect(new URL(googleCalendarLink(slot, 'x')).searchParams.has('details')).toBe(false);
	});
});
