import { describe, expect, it } from 'vitest';
import { HUES, hueFor } from './hue.js';

describe('hueFor', () => {
	it('is stable for the same id', () => {
		expect(hueFor('abc')).toBe(hueFor('abc'));
	});
	it('always returns one of the soft colours', () => {
		for (const id of ['', 'a', 'kabir', 'p_123', 'Mum']) expect(HUES).toContain(hueFor(id));
		expect(HUES).toContain(hueFor(undefined));
	});
	it('spreads people across the palette', () => {
		const seen = new Set(Array.from({ length: 40 }, (_, i) => hueFor(`person-${i}`)));
		expect(seen.size).toBeGreaterThanOrEqual(6);
	});
});
