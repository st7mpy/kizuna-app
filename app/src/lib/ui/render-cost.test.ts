// Guards for the things that made the app choppy: blur filters that the browser has to redraw on
// every frame, and glass (backdrop blur) on every card. The look is kept with cheaper means.
import { describe, expect, it } from 'vitest';
import { blurredEllipseAt, cloudGradient, spill } from './clouds.js';
import { wave } from './slow.js';

// Every component and stylesheet, as text.
const sources = import.meta.glob<string>('/src/**/*.{svelte,css}', { query: '?raw', import: 'default', eager: true });
const all = Object.entries(sources).map(([p, s]) => ({ p, s }));

/** The CSS rule bodies for a selector that starts with `sel` inside a <style> or .css file. */
function rules(css: string, sel: string): string[] {
	const out: string[] = [];
	const re = new RegExp(`(^|\\n)\\s*${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^{]*\\{([^}]*)\\}`, 'g');
	for (const m of css.matchAll(re)) out.push(m[2]);
	return out;
}

describe('render cost', () => {
	it('uses no SMIL animations (they repaint the whole drawing every frame)', () => {
		for (const { p, s } of all) expect(s, p).not.toMatch(/<animate(Transform|Motion)?\b/);
	});

	it('puts SVG blur filters only on the static bloom layer, never on animated parts', () => {
		for (const { p, s } of all) {
			// the poke seal: a small static drawing, pressed in once as a whole (a transform, no redraw)
			if (p.endsWith('Seal.svelte')) continue;
			if (!/\bfilter="url\(/.test(s)) continue;
			// everything after removing the static glow layers must be free of filters
			const rest = s.replace(/<svg class="glow"[\s\S]*?<\/svg>/g, '');
			expect(rest, p).not.toMatch(/\bfilter="url\(/);
			// and the glow layer itself holds no animations or slow-clock targets
			for (const glow of s.match(/<svg class="glow"[\s\S]*?<\/svg>/g) ?? []) {
				expect(glow, p).not.toMatch(/class="[^"]*\b(halo|pulse|grow|node|flare)\b/);
			}
		}
	});

	it('draws clouds without filter: blur', () => {
		for (const { p, s } of all) {
			for (const body of [...rules(s, '.cloud'), ...rules(s, '.cloud::before')]) expect(body, p).not.toMatch(/filter\s*:/);
		}
	});

	it('keeps backdrop blur to the few fixed surfaces', () => {
		expect(all.length).toBeGreaterThan(20);
		const users = all.filter(({ s }) => /(^|[^-])backdrop-filter\s*:/m.test(s)).map(({ p }) => p.split(/[/\\]/).pop());
		expect(users.sort()).toEqual(['Landing.svelte', 'NavBar.svelte', 'Sheet.svelte']);
	});
});

describe('clouds', () => {
	it('a big ellipse is solid in the middle and gone well outside', () => {
		expect(blurredEllipseAt(400, 200, 70, 0, 0)).toBeGreaterThan(0.97);
		expect(blurredEllipseAt(400, 200, 70, 400 + spill(70), 0)).toBeLessThan(0.02);
		// at the flat side of the ellipse the edge is half strength, as with a straight edge
		expect(blurredEllipseAt(400, 200, 70, 0, 200)).toBeCloseTo(0.5, 1);
	});
	it('a small ellipse under a wide blur comes out fainter, as the filter did', () => {
		expect(blurredEllipseAt(100, 58, 70, 0, 0)).toBeLessThan(0.6);
	});
	it('makes a radial gradient that fades to nothing', () => {
		const g = cloudGradient('red', 700, 400, 70);
		expect(g.startsWith('radial-gradient(closest-side')).toBe(true);
		expect(g).toMatch(/red 0%, transparent\) 100%\)$/);
		expect(g).not.toMatch(/blur/);
	});
	it('wave goes 0 to 1 and back over a period', () => {
		expect(wave(0, 4)).toBeCloseTo(0);
		expect(wave(2, 4)).toBeCloseTo(1);
		expect(wave(4, 4)).toBeCloseTo(0);
	});
});
