// Fine lines of light, shared by the landing's family tree and the map: seeded randomness,
// smooth curves through points, and tapering ribbons. Pure maths, no DOM.

export type Pt = { x: number; y: number };

/** Small fast PRNG (mulberry32). */
export function rng(seed: number): () => number {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/** Smooth curve through points (Catmull-Rom as cubic beziers), sampled finely. */
export function sampleCurve(pts: Pt[], perSeg = 14): Pt[] {
	const out: Pt[] = [];
	for (let i = 0; i < pts.length - 1; i++) {
		const p0 = pts[i - 1] ?? pts[i];
		const p1 = pts[i];
		const p2 = pts[i + 1];
		const p3 = pts[i + 2] ?? p2;
		const c1 = { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 };
		const c2 = { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 };
		for (let s = 0; s < perSeg; s++) {
			const t = s / perSeg;
			const u = 1 - t;
			out.push({
				x: u * u * u * p1.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * p2.x,
				y: u * u * u * p1.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * p2.y
			});
		}
	}
	out.push(pts[pts.length - 1]);
	return out;
}

/** The same curve as an SVG path of cubic beziers (for the growth mask and the travelling light). */
export function curvePath(pts: Pt[]): string {
	let d = `M${f(pts[0].x)} ${f(pts[0].y)}`;
	for (let i = 0; i < pts.length - 1; i++) {
		const p0 = pts[i - 1] ?? pts[i];
		const p1 = pts[i];
		const p2 = pts[i + 1];
		const p3 = pts[i + 2] ?? p2;
		d += `C${f(p1.x + (p2.x - p0.x) / 6)} ${f(p1.y + (p2.y - p0.y) / 6)} ${f(p2.x - (p3.x - p1.x) / 6)} ${f(p2.y - (p3.y - p1.y) / 6)} ${f(p2.x)} ${f(p2.y)}`;
	}
	return d;
}

/** A filled line that tapers from w0 to w1 along its length, so it reads as one stroke growing thinner. */
export function ribbon(line: Pt[], w0: number, w1: number): string {
	const n = line.length;
	if (n < 2) return '';
	const left: Pt[] = [];
	const right: Pt[] = [];
	for (let i = 0; i < n; i++) {
		const a = line[Math.max(0, i - 1)];
		const b = line[Math.min(n - 1, i + 1)];
		const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
		const nx = -(b.y - a.y) / len;
		const ny = (b.x - a.x) / len;
		const t = i / (n - 1);
		const hw = (w0 + (w1 - w0) * Math.pow(t, 0.8)) / 2;
		left.push({ x: line[i].x + nx * hw, y: line[i].y + ny * hw });
		right.push({ x: line[i].x - nx * hw, y: line[i].y - ny * hw });
	}
	const pts = [...left, ...right.reverse()];
	return 'M' + pts.map((p) => `${f(p.x)} ${f(p.y)}`).join('L') + 'Z';
}

export function f(n: number): string {
	return (Math.round(n * 10) / 10).toString();
}
