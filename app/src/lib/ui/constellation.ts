// Layout for the Kizuna map: you in the centre, family on an inner ring, friends on an outer one.
// Pure, so it can be tested: positions dots evenly, then places each label outward from the centre,
// falling back to below/above the dot, so no label overlaps another label, a dot or the edge.
import { curvePath, ribbon, rng, sampleCurve, type Pt } from './strands.js';

export interface Box {
	x: number;
	y: number;
	w: number;
	h: number;
}

export interface LayoutIn {
	id: string;
	ring: 'inner' | 'outer';
	name: string; // already shortened for display
	sub: string; // "01:30 Toronto"
}

export type Anchor = 'start' | 'middle' | 'end';

export interface LayoutDot {
	id: string;
	x: number;
	y: number;
	/** Label box (top-left), the text anchor and the x the text is drawn at. */
	label: Box;
	anchor: Anchor;
	tx: number;
}

export interface Layout {
	width: number;
	height: number;
	cx: number;
	cy: number;
	rings: { rx: number; ry: number }[];
	dots: LayoutDot[];
	/** Vertical crop that holds everything drawn: use as the viewBox y and height. */
	top: number;
	bottom: number;
	/** Number of labels that could not be placed cleanly (0 in every tested case). */
	clashes: number;
	/** Smallest angle (radians, seen from the centre) between any outer dot and any inner dot. */
	minGap: number;
}

export const WIDTH = 360;
export const DOT_R = 12;
/** Half-size of the square around a dot that also holds its small marks. */
export const DOT_BOX = 21;
const GAP = 4;
const NAME_PX = 15; // Geist 500
const SUB_PX = 9; // Geist, tabular, tracked capitals
export const LABEL_H = 38;
const EDGE = 4;

/** Rough width of a label, a little generous so real text never runs over. */
export function labelWidth(name: string, sub: string): number {
	const n = [...name].reduce((w, ch) => w + (/[A-Z]/.test(ch) ? 0.68 : /[mw]/.test(ch) ? 0.82 : 0.54), 0) * NAME_PX;
	const s = [...sub].length * 0.7 * SUB_PX;
	return Math.ceil(Math.max(n, s) + 6);
}

/** Names longer than this get an ellipsis; the full name stays in the aria-label. */
export function shortName(name: string, max = 12): string {
	const t = name.trim();
	if ([...t].length <= max) return t;
	const first = t.split(/\s+/)[0];
	if ([...first].length <= max) return first;
	return [...t].slice(0, max - 1).join('') + '…';
}

const overlap = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const inside = (a: Box, W: number, H: number) => a.x >= EDGE && a.y >= EDGE && a.x + a.w <= W - EDGE && a.y + a.h <= H - EDGE;
const dotBox = (x: number, y: number): Box => ({ x: x - DOT_BOX, y: y - DOT_BOX, w: DOT_BOX * 2, h: DOT_BOX * 2 });

interface Candidate {
	label: Box;
	anchor: Anchor;
	tx: number;
}

function candidates(x: number, y: number, cx: number, cy: number, w: number): Candidate[] {
	const dx = x - cx;
	const dy = y - cy;
	const len = Math.hypot(dx, dy) || 1;
	const ux = dx / len;
	const uy = dy / len;
	const off = DOT_BOX + GAP;
	const H = LABEL_H;
	const mk = (lx: number, ly: number, anchor: Anchor): Candidate => ({
		label: { x: lx, y: ly, w, h: H },
		anchor,
		tx: anchor === 'start' ? lx : anchor === 'end' ? lx + w : lx + w / 2
	});
	const below = mk(x - w / 2, y + off, 'middle');
	const above = mk(x - w / 2, y - off - H, 'middle');
	const right = mk(x + off, y - H / 2, 'start');
	const left = mk(x - off - w, y - H / 2, 'end');
	// Corners: the label hangs off the dot's diagonal, still pointing away from the centre.
	const belowR = mk(x + DOT_BOX * 0.4, y + off - 4, 'start');
	const belowL = mk(x - DOT_BOX * 0.4 - w, y + off - 4, 'end');
	const aboveR = mk(x + DOT_BOX * 0.4, y - off - H + 4, 'start');
	const aboveL = mk(x - DOT_BOX * 0.4 - w, y - off - H + 4, 'end');
	const vert = uy > 0 ? below : above;
	const vertOther = uy > 0 ? above : below;
	const side = ux > 0 ? right : left;
	const sideOther = ux > 0 ? left : right;
	const corner = uy > 0 ? (ux > 0 ? belowR : belowL) : ux > 0 ? aboveR : aboveL;
	const cornerSame = uy > 0 ? (ux > 0 ? belowL : belowR) : ux > 0 ? aboveL : aboveR;
	// Outward first: the side the dot faces away from the centre.
	const order =
		Math.abs(uy) >= 0.7
			? [vert, corner, side, cornerSame]
			: Math.abs(ux) >= 0.7
				? [side, corner, vert, cornerSame]
				: [corner, side, vert, cornerSame];
	return [...order, vertOther, sideOther];
}

function ringPoints(n: number, rx: number, ry: number, cx: number, cy: number, offset: number, stagger: number) {
	return Array.from({ length: n }, (_, i) => {
		const a = -Math.PI / 2 + offset + (i * 2 * Math.PI) / n;
		const k = i % 2 === 1 ? 1 - stagger : 1;
		return { x: cx + rx * k * Math.cos(a), y: cy + ry * k * Math.sin(a) };
	});
}

interface Shape {
	H: number;
	innerOff: number;
	outerOff: number;
	stagger: number;
	grow: number;
}

function attempt(people: LayoutIn[], W: number, { H, innerOff, outerOff, stagger, grow }: Shape, centre: Box): Layout {
	const cx = W / 2;
	const cy = H / 2;
	const inner = people.filter((p) => p.ring === 'inner');
	const outer = people.filter((p) => p.ring === 'outer');
	// Rings are ellipses, taller than wide, to suit a phone. One ring alone uses the space of both.
	const both = inner.length > 0 && outer.length > 0;
	const outerR = { rx: both ? 126 : 118, ry: H / 2 - 60 };
	const innerR = both ? { rx: 80 * grow, ry: Math.min(H / 2 - 118, 112) * grow } : outerR;
	const sIn = inner.length >= 5 ? stagger : 0;
	const sOut = outer.length >= 5 ? stagger : 0;
	const pts = [
		...ringPoints(inner.length, innerR.rx, innerR.ry, cx, cy, innerOff, sIn).map((p, i) => ({ ...p, who: inner[i] })),
		...ringPoints(outer.length, outerR.rx, outerR.ry, cx, cy, outerOff, sOut).map((p, i) => ({ ...p, who: outer[i] }))
	];
	// How close (by angle from the centre) any friend sits to a family dot.
	const ang = (p: { x: number; y: number }) => Math.atan2(p.y - cy, p.x - cx);
	let minGap = Infinity;
	for (const a of pts.slice(0, inner.length))
		for (const b of pts.slice(inner.length)) {
			const d = Math.abs(ang(a) - ang(b)) % (2 * Math.PI);
			minGap = Math.min(minGap, d > Math.PI ? 2 * Math.PI - d : d);
		}
	const fixed: Box[] = [centre, ...pts.map((p) => dotBox(p.x, p.y))];
	const placed: Box[] = [];
	let clashes = 0;
	const dots: LayoutDot[] = pts.map((p) => {
		const w = labelWidth(p.who.name, p.who.sub);
		const cands = candidates(p.x, p.y, cx, cy, w);
		const ok = cands.find(
			(c) =>
				inside(c.label, W, H) &&
				!fixed.some((b) => overlap(b, c.label)) &&
				!placed.some((b) => overlap(b, c.label))
		);
		let pick = ok;
		if (!pick) {
			clashes++;
			pick = cands.find((c) => inside(c.label, W, H)) ?? cands[0];
		}
		placed.push(pick.label);
		return { id: p.who.id, x: p.x, y: p.y, label: pick.label, anchor: pick.anchor, tx: pick.tx };
	});
	const rings = both ? [innerR, outerR] : people.length ? [outerR] : [];
	const ys = [
		centre.y,
		centre.y + centre.h,
		...rings.flatMap((r) => [cy - r.ry, cy + r.ry]),
		...dots.flatMap((d) => [d.y - DOT_BOX, d.y + DOT_BOX, d.label.y, d.label.y + d.label.h])
	];
	const top = Math.max(0, Math.floor(Math.min(...ys)) - 6);
	const bottom = Math.min(H, Math.ceil(Math.max(...ys)) + 6);
	return { width: W, height: H, cx, cy, rings, dots, clashes, minGap, top, bottom };
}

/** The centre box ("you" mark and your time). */
export function centreBox(cx: number, cy: number): Box {
	return { x: cx - 40, y: cy - 22, w: 80, h: 58 };
}

/** Friends should sit between family dots, never on the same line out from the centre. */
export const MIN_RING_GAP = (20 * Math.PI) / 180;

/** The widest angle friends could keep from family dots on round rings (to know what to aim for). */
export function idealGap(nIn: number, nOut: number): number {
	if (!nIn || !nOut) return Infinity;
	const stepIn = (2 * Math.PI) / nIn;
	const stepOut = (2 * Math.PI) / nOut;
	let best = 0;
	for (let t = 0; t < 360; t++) {
		const o = (t / 360) * stepIn;
		let gap = Infinity;
		for (let k = 0; k < nOut; k++) {
			const r = (o + k * stepOut) % stepIn;
			gap = Math.min(gap, r, stepIn - r);
		}
		best = Math.max(best, gap);
	}
	return best;
}

export function layoutConstellation(people: LayoutIn[], width = WIDTH): Layout {
	const list = people.slice(0, 8);
	const nInner = list.filter((p) => p.ring === 'inner').length;
	const nOuter = list.length - nInner;
	const nIn = Math.max(1, nInner);
	const nOut = Math.max(1, nOuter);
	const stepIn = (2 * Math.PI) / nIn;
	const stepOut = (2 * Math.PI) / nOut;
	const aim = Math.min(MIN_RING_GAP, idealGap(nInner, nOuter) * 0.8);
	// Better: fewer clashes first, then friends further from family lines.
	const better = (a: Layout, b: Layout | null) =>
		!b || a.clashes < b.clashes || (a.clashes === b.clashes && a.minGap > b.minGap + 1e-6);
	let best: Layout | null = null;
	// Smallest, calmest shape first; within a size, the turn that sits friends most between family.
	for (const H of [400, 440, 480, 520, 560]) {
		const centre = centreBox(width / 2, H / 2);
		let here = null as Layout | null;
		for (const [stagger, grow] of [[0, 1], [0.14, 1], [0, 1.2], [0.24, 1], [0.14, 1.2], [0, 1.35], [0.18, 1.35]]) {
			for (let i = 0; i < 8; i++) {
				const innerOff = (i * stepIn) / 8;
				for (let j = 0; j < 16; j++) {
					const outerOff = innerOff + stepIn / 2 + (j * stepOut) / 16;
					const l = attempt(list, width, { H, stagger, grow, innerOff, outerOff }, centre);
					if (better(l, here)) here = l;
				}
			}
			if (here && here.clashes === 0 && here.minGap >= Math.max(aim, idealGap(nInner, nOuter) * 0.95)) return here;
		}
		if (here && here.clashes === 0 && here.minGap >= aim) return here;
		if (better(here!, best)) best = here;
	}
	return best!;
}

/** "Toronto" from "America/Toronto"; a few zones get a shorter or better-known name. */
const ZONE_NAMES: Record<string, string> = {
	'Asia/Kolkata': 'Kolkata',
	'Asia/Calcutta': 'Kolkata',
	'Europe/London': 'London',
	'America/New_York': 'New York',
	'America/Los_Angeles': 'LA',
	'Asia/Dubai': 'Dubai',
	'Asia/Singapore': 'Singapore',
	'Australia/Sydney': 'Sydney'
};
export function cityOf(tz: string | null | undefined): string {
	if (!tz) return '';
	if (ZONE_NAMES[tz]) return ZONE_NAMES[tz];
	const last = (tz.split('/').pop() ?? tz).replace(/_/g, ' ');
	return last.length > 12 ? last.slice(0, 11) + '…' : last;
}

/** "Kabir, 01:30 in Toronto, open to a call" */
export function dotLabel(p: {
	name: string;
	localTime: string | null;
	tz: string | null;
	glow: 'open' | 'maybe' | null;
	occasion?: { name: string } | null;
	hasGift?: boolean;
}): string {
	const parts = [p.name];
	if (p.localTime) parts.push(p.tz ? `${p.localTime} in ${cityOf(p.tz)}` : p.localTime);
	if (p.glow === 'open') parts.push('open to a call');
	else if (p.glow === 'maybe') parts.push('maybe later');
	if (p.occasion) parts.push(p.occasion.name);
	if (p.hasGift) parts.push('gift idea saved');
	return parts.join(', ');
}

/** One beam of light from you to a person: a few fine strands, gently swirled, thinning outward. */
export interface Beam {
	/** Centre line, for the growth mask and the light that travels along it. */
	spine: string;
	strands: { d: string; hue: number; opacity: number }[];
	/** Angle from the top, clockwise, 0..1: the order the dots light up in. */
	turn: number;
}

/** Stable small number from an id, so a person's strands look the same on every visit. */
export function seedOf(id: string): number {
	let h = 2166136261;
	for (const ch of id) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
	return h >>> 0;
}

export function beam(from: Pt, to: Pt, id: string, count = 4): Beam {
	const rand = rng(seedOf(id));
	const dx = to.x - from.x;
	const dy = to.y - from.y;
	const len = Math.hypot(dx, dy) || 1;
	// A slight clockwise swirl, the same for everyone, so the map turns like one quiet galaxy.
	const nx = -dy / len;
	const ny = dx / len;
	const at = (t: number, bend: number): Pt => ({ x: from.x + dx * t + nx * bend * len, y: from.y + dy * t + ny * bend * len });
	const route = [from, at(0.38, 0.07), at(0.72, 0.045), to];
	const strands = Array.from({ length: count }, (_, s) => {
		const pts = route.map((q, k) => {
			if (k === 0) return { x: q.x + (rand() - 0.5) * 1.5, y: q.y + (rand() - 0.5) * 1.5 };
			if (k === route.length - 1) return { x: q.x + (rand() - 0.5) * 2, y: q.y + (rand() - 0.5) * 2 };
			const amp = 2.5 + k * 1.6;
			return { x: q.x + (rand() - 0.5) * 2 * amp, y: q.y + (rand() - 0.5) * 2 * amp };
		});
		return { d: ribbon(sampleCurve(pts, 14), 2.2 - s * 0.35, 0.55), hue: Math.floor(rand() * 3), opacity: 0.55 + rand() * 0.45 };
	});
	const turn = ((Math.atan2(dx, -dy) / (2 * Math.PI)) + 1) % 1;
	return { spine: curvePath(route), strands, turn };
}
