import { describe, expect, it } from 'vitest';
import { cityOf, idealGap, dotLabel, labelWidth, layoutConstellation, shortName, type Box, type LayoutIn } from './constellation.js';

const overlap = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const LONG = ['Grandmother Kamala', 'Uncle Rajendra', 'Abhimanyu', 'Christopher', 'Anastasia', 'Meenakshi', 'Bartholomew', 'Wilhelmina'];

function people(nInner: number, nOuter: number): LayoutIn[] {
	return Array.from({ length: nInner + nOuter }, (_, i) => ({
		id: `p${i}`,
		ring: i < nInner ? 'inner' : 'outer',
		name: shortName(LONG[i % LONG.length]),
		sub: '01:30 Buenos Aire…'
	}));
}

describe('layoutConstellation', () => {
	for (const [a, b] of [
		[8, 0], [0, 8], [6, 2], [2, 6], [4, 4], [5, 3], [3, 5], [1, 7], [7, 1], [3, 0], [1, 0], [0, 1], [2, 2]
	]) {
		it(`places ${a} family and ${b} friends with no overlapping labels`, () => {
			const l = layoutConstellation(people(a, b));
			expect(l.clashes).toBe(0);
			expect(l.dots).toHaveLength(a + b);
			for (const d of l.dots) {
				expect(d.label.x).toBeGreaterThanOrEqual(0);
				expect(d.label.y).toBeGreaterThanOrEqual(0);
				expect(d.label.x + d.label.w).toBeLessThanOrEqual(l.width);
				expect(d.label.y + d.label.h).toBeLessThanOrEqual(l.height);
			}
			for (let i = 0; i < l.dots.length; i++)
				for (let j = i + 1; j < l.dots.length; j++) expect(overlap(l.dots[i].label, l.dots[j].label)).toBe(false);
		});
	}
	it('never shows more than 8 people', () => {
		expect(layoutConstellation(people(6, 6)).dots.length).toBe(8);
	});
	it('handles nobody', () => {
		expect(layoutConstellation([]).dots).toEqual([]);
	});
});

describe('labels', () => {
	it('shortens long names', () => {
		expect(shortName('Grandmother Kamala')).toBe('Grandmother');
		expect(shortName('Mum')).toBe('Mum');
		expect(shortName('Bartholomewsky')).toBe('Bartholomew…');
	});
	it('gives longer text a wider box', () => {
		expect(labelWidth('Wilhelmina', '')).toBeGreaterThan(labelWidth('Mum', ''));
	});
	it('names the city from the zone', () => {
		expect(cityOf('America/Toronto')).toBe('Toronto');
		expect(cityOf('Asia/Kolkata')).toBe('India');
		expect(cityOf('America/Argentina/Buenos_Aires')).toBe('Buenos Aires');
		expect(cityOf(null)).toBe('');
	});
	it('reads the whole dot aloud', () => {
		expect(dotLabel({ name: 'Kabir', localTime: '01:30', tz: 'America/Toronto', glow: 'open' })).toBe(
			'Kabir, 01:30 in Toronto, open to a call'
		);
	});
});

describe('crop', () => {
	it('keeps every label inside the cropped view', () => {
		const l = layoutConstellation(people(5, 2));
		for (const d of l.dots) {
			expect(d.label.y).toBeGreaterThanOrEqual(l.top);
			expect(d.label.y + d.label.h).toBeLessThanOrEqual(l.bottom);
		}
	});
});

describe('rings', () => {
	// Counts where friends can sit at least 20 degrees from every family dot.
	// (4+3, 3+5, 5+3 and 5+2 can't reach 20 degrees even on perfect circles; see idealGap.)
	for (const [a, b] of [[4, 2], [4, 4], [2, 6], [6, 2], [2, 2], [1, 7], [3, 3], [1, 2], [2, 3], [7, 1]]) {
		it(`keeps ${b} friends off the lines of ${a} family dots`, () => {
			const l = layoutConstellation(people(a, b));
			expect(l.clashes).toBe(0);
			expect((l.minGap * 180) / Math.PI).toBeGreaterThanOrEqual(20);
		});
	}
});

describe('rings when 20 degrees is out of reach', () => {
	for (const [a, b] of [[4, 3], [3, 5], [5, 3], [5, 2]]) {
		it(`gets close to the best possible for ${a} family and ${b} friends`, () => {
			const l = layoutConstellation(people(a, b));
			expect(l.clashes).toBe(0);
			expect(l.minGap).toBeGreaterThanOrEqual(idealGap(a, b) * 0.8);
		});
	}
});
