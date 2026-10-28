import { describe, expect, it } from 'vitest';
import { usefulSummary } from './local.ts';
import { isIosTab } from './storage.ts';
import { isResting, markResting } from './relay.ts';

describe('was this useful', () => {
	it('sums up answers in one line a tester can share', () => {
		expect(usefulSummary([])).toBe('');
		expect(
			usefulSummary([
				{ at: '2026-10-28T10:00:00Z', answer: 'yes', what: 'line' },
				{ at: '2026-10-29T10:00:00Z', answer: 'not_really', what: 'group' },
				{ at: '2026-10-31T10:00:00Z', answer: 'yes', what: 'line' }
			])
		).toBe('Kizuna was useful 2 of 3 times I sent a line (28 Oct to 31 Oct).');
	});
});

describe('keeping notes on iPhone', () => {
	const iphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1';
	it('hints only in an iPhone or iPad tab, not the Home Screen app or other phones', () => {
		expect(isIosTab(iphone, false)).toBe(true);
		expect(isIosTab(iphone, true)).toBe(false);
		expect(isIosTab('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15', false, true)).toBe(true); // iPad
		expect(isIosTab('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15', false, false)).toBe(false);
		expect(isIosTab('Mozilla/5.0 (Linux; Android 15; Pixel 9) Chrome/130 Mobile', false)).toBe(false);
	});
});

describe('resting', () => {
	it('rests until the relay says the daily allowance is back', () => {
		const t = Date.parse('2026-11-02T20:00:00Z');
		expect(isResting(t)).toBe(false);
		markResting(3600, t);
		expect(isResting(t + 60_000)).toBe(true);
		expect(isResting(t + 3_601_000)).toBe(false);
	});
});
