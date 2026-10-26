import { describe, expect, it } from 'vitest';
import { andList, giftLead, inDays, occasionChip, skippedLine, traceLine, whenLocal } from './mapformat.js';

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
