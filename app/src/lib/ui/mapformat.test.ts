import { describe, expect, it } from 'vitest';
import {
	andList,
	giftLead,
	inDays,
	initials,
	memberStatus,
	occasionChip,
	skippedLine,
	traceLine,
	whenLocal
} from './mapformat.js';

describe('map words', () => {
	it('says when in the given zone', () => {
		expect(whenLocal('2026-11-08T11:00:00+05:30', 'Asia/Kolkata')).toBe('Sunday 11:00');
		expect(whenLocal('2026-11-08T11:00:00+05:30', 'America/Toronto')).toBe('Sunday 00:30');
	});
	it('lists names', () => {
		expect(andList(['Mum'])).toBe('Mum');
		expect(andList(['Mum', 'Papa', 'Riya'])).toBe('Mum, Papa and Riya');
	});
	it('traces the tools in plain words', () => {
		expect(traceLine(['get_windows', 'get_occasions', 'get_local_time', 'get_windows', 'finish'])).toBe(
			'checked windows · occasions · local times'
		);
		expect(traceLine([])).toBe('');
	});
	it('words days, never as a counter of neglect', () => {
		expect(inDays(0)).toBe('today');
		expect(inDays(1)).toBe('tomorrow');
		expect(giftLead("Papa's birthday", 9)).toBe("Papa's birthday is in 9 days.");
	});
	it('makes an occasion chip', () => {
		expect(occasionChip('Diwali', '2026-11-08')).toBe('Diwali · Sun 8 Nov');
	});
	it('adds the name to a skipped reason', () => {
		expect(skippedLine('Kabir', "It's 00:30 in Toronto then.")).toBe("Kabir: It's 00:30 in Toronto then.");
		expect(skippedLine('Kabir', 'Kabir is asleep then.')).toBe('Kabir is asleep then.');
	});
});

describe('member list words', () => {
	const city = (tz: string | null) => (tz === 'Asia/Kolkata' ? 'Delhi' : tz ? 'Toronto' : '');
	it('makes initials', () => {
		expect(initials('Kabir Bhatia')).toBe('KB');
		expect(initials('Mum')).toBe('M');
		expect(initials('  ')).toBe('·');
	});
	it('says open, night, plain or nothing shared', () => {
		expect(memberStatus({ localTime: '18:30', tz: 'Asia/Kolkata', daylight: 0.2, glow: 'open' }, city)).toEqual({
			text: 'Open to a call · 18:30 Delhi',
			tone: 'open'
		});
		expect(memberStatus({ localTime: '01:30', tz: 'America/Toronto', daylight: 0, glow: null }, city).text).toBe(
			'Night there · 01:30 Toronto'
		);
		expect(memberStatus({ localTime: '11:00', tz: 'Asia/Kolkata', daylight: 0.8, glow: null }, city).tone).toBe('plain');
		expect(memberStatus({ localTime: null, tz: null, daylight: 1, glow: null }, city).text).toBe('Nothing shared');
	});
});
