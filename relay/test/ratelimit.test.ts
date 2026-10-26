import { describe, expect, it } from 'vitest';
import { RateLimiter } from '../src/ratelimit.ts';

describe('RateLimiter', () => {
	it('refills over time', () => {
		const l = new RateLimiter({ capacity: 2, refillPerMinute: 1, daily: 100 });
		const t = Date.parse('2026-11-02T10:00:00Z');
		expect(l.take('k', t)).toBe(true);
		expect(l.take('k', t)).toBe(true);
		expect(l.take('k', t)).toBe(false);
		expect(l.take('k', t + 30_000)).toBe(false);
		expect(l.take('k', t + 61_000)).toBe(true);
	});

	it('enforces a daily cap that resets at UTC midnight', () => {
		const l = new RateLimiter({ capacity: 100, refillPerMinute: 100, daily: 3 });
		const t = Date.parse('2026-11-02T23:00:00Z');
		for (let i = 0; i < 3; i++) expect(l.take('k', t + i)).toBe(true);
		expect(l.take('k', t + 3_600_000 - 1)).toBe(false);
		expect(l.take('k', t + 3_600_000 + 1)).toBe(true);
	});
});
