import { afterEach, describe, expect, it } from 'vitest';
import { daylightIn, timeIn } from './clock.js';
import { clearEntered, hasEntered, markEntered } from './entered.js';

describe('landing clock', () => {
	const at = new Date('2026-10-30T12:30:00Z');
	it('gives 24-hour local time per city', () => {
		expect(timeIn('Asia/Kolkata', at)).toBe('18:00');
		expect(timeIn('America/Toronto', at)).toBe('08:30');
		expect(timeIn('Europe/London', at)).toBe('12:30');
	});
	it('fades daylight at dusk and is dark at night', () => {
		expect(daylightIn('Europe/London', at)).toBe(1);
		expect(daylightIn('Asia/Kolkata', new Date('2026-10-30T13:00:00Z'))).toBeCloseTo(0.5);
		expect(daylightIn('Asia/Kolkata', new Date('2026-10-30T20:00:00Z'))).toBe(0);
	});
	it('is safe with an unknown zone', () => {
		expect(timeIn('Nowhere/Atlantis', at)).toBe('');
		expect(daylightIn('Nowhere/Atlantis', at)).toBe(1);
	});
});

describe('entered flag', () => {
	const store = new Map<string, string>();
	(globalThis as { localStorage?: unknown }).localStorage ??= {
		getItem: (k: string) => store.get(k) ?? null,
		setItem: (k: string, v: string) => void store.set(k, v),
		removeItem: (k: string) => void store.delete(k)
	};
	afterEach(() => clearEntered());

	it('starts unset, then remembers', () => {
		expect(hasEntered()).toBe(false);
		markEntered();
		expect(hasEntered()).toBe(true);
	});
});
