// Geometry for the landing's family tree: fine lines that grow from "you" and branch out to each person.
// Pure maths, no DOM, seeded so the drawing is the same on every load.
import { daylightIn, timeIn } from './clock.js';

export type Pt = { x: number; y: number };

export type TreePerson = {
	name: string;
	place: string;
	tz: string;
	/** Open to a call. Only glows while it's daytime there. */
	open?: boolean;
	/** Close family branch out first; far ones take the long branches. Defaults by order. */
	ring?: 'near' | 'far';
};

export const SAMPLE_FAMILY: TreePerson[] = [
	{ name: 'Nani', place: 'Delhi', tz: 'Asia/Kolkata', open: true, ring: 'near' },
	{ name: 'Mum', place: 'Delhi', tz: 'Asia/Kolkata', open: true, ring: 'near' },
	{ name: 'Papa', place: 'Delhi', tz: 'Asia/Kolkata', ring: 'near' },
	{ name: 'Riya', place: 'Bengaluru', tz: 'Asia/Kolkata', ring: 'near' },
	{ name: 'Kabir', place: 'Toronto', tz: 'America/Toronto', open: true, ring: 'far' },
	{ name: 'Meera', place: 'London', tz: 'Europe/London', ring: 'far' }
];

export const W = 560;
export const H = 446;
export const ROOT: Pt = { x: 280, y: 414 };

type Slot = { via: Pt[]; at: Pt; label: 'above' | 'below' };

// Hand-placed so labels never meet a branch. Each route starts at the root and shares limbs with its neighbours.
const TRUNK: Pt = { x: 278, y: 370 };
const LEFT: Pt = { x: 232, y: 336 };
const RIGHT: Pt = { x: 330, y: 338 };
const NEAR: Slot[] = [
	{ via: [TRUNK, LEFT, { x: 170, y: 318 }], at: { x: 116, y: 296 }, label: 'below' },
	{ via: [TRUNK, LEFT, { x: 222, y: 272 }], at: { x: 206, y: 216 }, label: 'above' },
	{ via: [TRUNK, RIGHT, { x: 348, y: 262 }], at: { x: 358, y: 196 }, label: 'above' },
	{ via: [TRUNK, RIGHT, { x: 402, y: 300 }], at: { x: 458, y: 316 }, label: 'below' }
];
const FAR: Slot[] = [
	{ via: [TRUNK, LEFT, { x: 160, y: 256 }, { x: 104, y: 168 }], at: { x: 72, y: 92 }, label: 'above' },
	{ via: [TRUNK, RIGHT, { x: 420, y: 246 }, { x: 466, y: 146 }], at: { x: 486, y: 70 }, label: 'above' },
	{ via: [TRUNK, { x: 282, y: 300 }, { x: 272, y: 196 }, { x: 288, y: 120 }], at: { x: 280, y: 62 }, label: 'above' }
];

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

export type Strand = { d: string; hue: number; opacity: number };
export type Branch = {
	person: TreePerson;
	at: Pt;
	label: 'above' | 'below';
	/** Centre line from the root, for the growth mask and the light that travels along open branches. */
	spine: string;
	strands: Strand[];
	far: boolean;
};

/** Lay the people out on branches. Up to 4 near and 3 far; anyone past that is left off. */
export function grow(people: TreePerson[], seed = 7): Branch[] {
	const rand = rng(seed);
	const near: TreePerson[] = [];
	const far: TreePerson[] = [];
	people.forEach((p, i) => ((p.ring ?? (i < 4 ? 'near' : 'far')) === 'far' ? far : near).push(p));

	const out: Branch[] = [];
	const place = (p: TreePerson, slot: Slot, isFar: boolean) => {
		const route = [ROOT, ...slot.via, slot.at];
		const count = isFar ? 4 : 3;
		const strands: Strand[] = [];
		for (let s = 0; s < count; s++) {
			// Every strand wanders a little off the route, more in the middle than at either end.
			const pts = route.map((q, k) => {
				if (k === 0) return { x: q.x + (rand() - 0.5) * 2, y: q.y };
				if (k === route.length - 1) return { x: q.x + (rand() - 0.5) * 1.5, y: q.y + (rand() - 0.5) * 1.5 };
				const amp = 3 + Math.min(k, 3) * 2.6;
				return { x: q.x + (rand() - 0.5) * 2 * amp, y: q.y + (rand() - 0.5) * 2 * amp };
			});
			const line = sampleCurve(pts, 16);
			const w0 = (isFar ? 2.3 : 2.0) - s * 0.3;
			strands.push({ d: ribbon(line, w0, 0.55), hue: Math.floor(rand() * 3), opacity: 0.55 + rand() * 0.45 });
		}
		out.push({ person: p, at: slot.at, label: slot.label, spine: curvePath(route), strands, far: isFar });
	};
	near.slice(0, NEAR.length).forEach((p, i) => place(p, NEAR[i], false));
	far.slice(0, FAR.length).forEach((p, i) => place(p, FAR[i], true));
	return out;
}

export type NodeState = { time: string; night: boolean; glow: boolean };

export function nodeState(p: TreePerson, at: Date = new Date()): NodeState {
	const night = daylightIn(p.tz, at) < 0.5;
	return { time: timeIn(p.tz, at), night, glow: !!p.open && !night };
}

/** What a screen reader hears: who's here, who's free, who's asleep. */
export function treeLabel(people: TreePerson[], at: Date = new Date()): string {
	const states = people.map((p) => ({ p, s: nodeState(p, at) }));
	const free = states.filter((x) => x.s.glow).map((x) => x.p.name);
	const night = states.filter((x) => x.s.night).map((x) => `${x.p.name} (${x.s.time} in ${x.p.place})`);
	const parts = [`Your family, branching out from you: ${list(people.map((p) => p.name))}.`];
	parts.push(free.length ? `Open to a call now: ${list(free)}.` : 'Nobody is free for a call right now.');
	if (night.length) parts.push(`Night there: ${list(night)}.`);
	return parts.join(' ');
}

function list(xs: string[]): string {
	if (xs.length <= 1) return xs.join('');
	return `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`;
}

function f(n: number): string {
	return (Math.round(n * 10) / 10).toString();
}
