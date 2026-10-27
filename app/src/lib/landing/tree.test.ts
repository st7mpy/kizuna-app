import { describe, expect, it } from 'vitest';
import { H, SAMPLE_FAMILY, W, grow, nodeState, ribbon, rng, sampleCurve, treeLabel } from './tree.js';

describe('family tree', () => {
	it('is the same drawing every time for a seed', () => {
		expect(grow(SAMPLE_FAMILY, 7)).toEqual(grow(SAMPLE_FAMILY, 7));
		expect(grow(SAMPLE_FAMILY, 7)[0].strands[0].d).not.toBe(grow(SAMPLE_FAMILY, 8)[0].strands[0].d);
		const r = rng(1);
		const xs = Array.from({ length: 50 }, r);
		expect(xs.every((x) => x >= 0 && x < 1)).toBe(true);
	});

	it('gives everyone a branch inside the frame, far people more strands', () => {
		const bs = grow(SAMPLE_FAMILY);
		expect(bs.map((b) => b.person.name).sort()).toEqual(SAMPLE_FAMILY.map((p) => p.name).sort());
		for (const b of bs) {
			expect(b.at.x).toBeGreaterThan(0);
			expect(b.at.x).toBeLessThan(W);
			expect(b.at.y).toBeGreaterThan(0);
			expect(b.at.y).toBeLessThan(H);
			expect(b.spine.startsWith('M')).toBe(true);
		}
		expect(bs.find((b) => b.person.name === 'Kabir')!.strands.length).toBeGreaterThan(bs.find((b) => b.person.name === 'Mum')!.strands.length);
	});

	it('leaves off people past the slots instead of overlapping them', () => {
		const many = Array.from({ length: 12 }, (_, i) => ({ name: `P${i}`, place: 'Delhi', tz: 'Asia/Kolkata' }));
		expect(grow(many).length).toBe(7);
	});

	it('draws a closed, tapering ribbon along a smooth curve', () => {
		const line = sampleCurve([{ x: 0, y: 0 }, { x: 50, y: 20 }, { x: 100, y: 0 }], 10);
		expect(line.length).toBe(21);
		expect(line[20]).toEqual({ x: 100, y: 0 });
		const d = ribbon(line, 2, 0.5);
		expect(d.startsWith('M') && d.endsWith('Z')).toBe(true);
	});

	it('glows only when open and daytime there, and says so for screen readers', () => {
		const at = new Date('2026-10-30T12:30:00Z'); // 18:00 Delhi, 08:30 Toronto, 12:30 London
		const night = new Date('2026-10-30T05:00:00Z'); // 01:00 Toronto
		const kabir = SAMPLE_FAMILY.find((p) => p.name === 'Kabir')!;
		expect(nodeState(kabir, at)).toEqual({ time: '08:30', night: false, glow: true });
		expect(nodeState(kabir, night)).toEqual({ time: '01:00', night: true, glow: false });
		const label = treeLabel(SAMPLE_FAMILY, night);
		expect(label).toContain('Open to a call now: Nani and Mum.');
		expect(label).toContain('Kabir (01:00 in Toronto)');
		expect(label).not.toMatch(/—/);
	});
});
