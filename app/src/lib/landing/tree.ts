// Geometry for the landing's family tree: fine lines that grow from "you" and branch out to each person.
// Pure maths, no DOM, seeded so the drawing is the same on every load.
import { daylightIn, timeIn } from './clock.js';
import { curvePath, ribbon, rng, sampleCurve, type Pt } from '../ui/strands.js';

export { curvePath, ribbon, rng, sampleCurve, type Pt };

export type TreePerson = {
	name: string;
	place: string;
	tz: string;
	/** Open to a call. Only glows while it's daytime there. */
	open?: boolean;
	/** Close family branch out first; far ones take the long branches. Defaults by order. */
	ring?: 'near' | 'far';
};

/** Where "you" live in the sample families (their fixtures set homeTz to the same zone). */
export const SAMPLE_HOME = { place: 'Chicago', tz: 'America/Chicago' };

export const SAMPLE_FAMILY: TreePerson[] = [
	{ name: 'Grandma', place: 'Chicago', tz: 'America/Chicago', open: true, ring: 'near' },
	{ name: 'Mom', place: 'Chicago', tz: 'America/Chicago', open: true, ring: 'near' },
	{ name: 'Dad', place: 'Chicago', tz: 'America/Chicago', ring: 'near' },
	{ name: 'Maya', place: 'New York', tz: 'America/New_York', ring: 'near' },
	{ name: 'Leo', place: 'Melbourne', tz: 'Australia/Melbourne', open: true, ring: 'far' },
	{ name: 'Jordan', place: 'LA', tz: 'America/Los_Angeles', ring: 'far' }
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
