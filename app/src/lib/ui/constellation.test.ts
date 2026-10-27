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
	it('keeps the name after a kin word', () => {
		expect(shortName('Aunt Carmen Delacroix')).toBe('Aunt Carmen');
		expect(shortName('Uncle Bartholomew Smith')).toBe('Uncle Barth…');
		expect(shortName('Mia Rodriguez-Hernandez')).toBe('Mia');
	});
	it('gives longer text a wider box', () => {
		expect(labelWidth('Wilhelmina', '')).toBeGreaterThan(labelWidth('Mum', ''));
	});
	it('names the city from the zone', () => {
		expect(cityOf('America/Toronto')).toBe('Toronto');
		expect(cityOf('Asia/Kolkata')).toBe('Kolkata');
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
	for (const [a, b] of [[4, 2], [4, 4], [2, 6], [6, 2], [2, 2], [1, 7], [3, 3], [1, 2], [2, 3]]) {
		it(`keeps ${b} friends off the lines of ${a} family dots`, () => {
			const l = layoutConstellation(people(a, b));
			expect(l.clashes).toBe(0);
			expect((l.minGap * 180) / Math.PI).toBeGreaterThanOrEqual(20);
		});
	}
});

describe('rings when labels by their own dots come first', () => {
	// 7 family and 1 friend, all with very long names: keeping every label clearly by its own dot
	// costs a little of the friend's angle (about 20 degrees of an ideal 25.7).
	it('keeps the friend well off the family lines', () => {
		const l = layoutConstellation(people(7, 1));
		expect(l.clashes).toBe(0);
		expect(l.strays).toBe(0);
		expect(l.minGap).toBeGreaterThanOrEqual(idealGap(7, 1) * 0.75);
	});
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

describe('eight people', () => {
	const dist = (b: Box, x: number, y: number) =>
		Math.hypot(Math.max(b.x - x, 0, x - (b.x + b.w)), Math.max(b.y - y, 0, y - (b.y + b.h)));
	const names = ['Grandpa', 'Mia', 'Grandma', 'Mom', 'Kai', 'Aunt Carmen', 'Tyler', 'Uncle Dave'];
	const subs = ['04:10 Phoenix', '07:10 New York', '04:10 Phoenix', '06:10 Chicago', '01:10 Honolulu', '05:10 Denver', '07:10 Detroit', '04:10 LA'];
	for (const [a, b] of [[8, 0], [0, 8], [6, 2], [4, 4], [5, 3], [3, 5], [2, 6]]) {
		it(`keeps each label next to its own dot with ${a} family and ${b} friends`, () => {
			const list: LayoutIn[] = names.map((n, i) => ({ id: `p${i}`, ring: i < a ? 'inner' : 'outer', name: n, sub: subs[i] }));
			const l = layoutConstellation(list);
			expect(l.clashes).toBe(0);
			for (const d of l.dots) {
				const mine = dist(d.label, d.x, d.y);
				for (const o of l.dots) if (o !== d) expect(dist(d.label, o.x, o.y)).toBeGreaterThan(mine);
			}
			// and no two labels nearly touch
			for (let i = 0; i < l.dots.length; i++)
				for (let j = i + 1; j < l.dots.length; j++) {
					const p = l.dots[i].label;
					const q = l.dots[j].label;
					const gap = Math.max(q.x - (p.x + p.w), p.x - (q.x + q.w), q.y - (p.y + p.h), p.y - (q.y + q.h));
					expect(gap).toBeGreaterThanOrEqual(4);
				}
		});
	}
});
