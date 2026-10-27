// Soft clouds without a blur filter. A cloud used to be an ellipse with `filter: blur(70px)`
// drifting about: the browser redrew that huge blur, and every glass surface over it, on every
// frame. Now the blur is worked out once as a radial gradient (the same falloff, from the
// ellipse's real size), and the cloud drifts on a slow clock with a plain transform.
import { slowLoop, wave } from './slow.js';

/** Error function (Abramowitz and Stegun 7.1.26, good to about 1e-7). */
export function erf(x: number): number {
	const t = 1 / (1 + 0.3275911 * Math.abs(x));
	const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
	return x < 0 ? -y : y;
}

/** How strong an ellipse (semi-axes a, b) is at (x, y) once blurred by sigma: 0..1. */
export function blurredEllipseAt(a: number, b: number, sigma: number, x: number, y: number): number {
	// The Gaussian splits into x and y: across each thin column of the ellipse the y part has a
	// closed form (erf), so only the columns need summing. Cheap enough to run on load.
	const n = 64;
	const k = 1 / (sigma * Math.SQRT2);
	const du = (2 * a) / n;
	let sum = 0;
	for (let i = 0; i < n; i++) {
		const u = -a + (i + 0.5) * du;
		const half = b * Math.sqrt(Math.max(0, 1 - (u * u) / (a * a)));
		const gx = Math.exp(-((x - u) * (x - u)) / (2 * sigma * sigma));
		sum += gx * 0.5 * (erf((half - y) * k) + erf((half + y) * k)) * du;
	}
	return sum / (sigma * Math.sqrt(2 * Math.PI));
}

/** Margin round the ellipse that the blur spills into. */
export const spill = (sigma: number) => Math.round(sigma * 2.6);

/**
 * Radial gradient stops (closest-side) for an ellipse w x h blurred by sigma, drawn on a box
 * `spill(sigma)` larger on every side. `color` is any CSS colour (a var() is fine).
 */
export function cloudGradient(color: string, w: number, h: number, sigma: number, steps = 9): string {
	const a = Math.max(1, w / 2);
	const b = Math.max(1, h / 2);
	const m = spill(sigma);
	const stops: string[] = [];
	for (let k = 0; k <= steps; k++) {
		const f = k / steps;
		// along both axes, averaged: the gradient is elliptical, the blurred shape nearly so
		const p = (blurredEllipseAt(a, b, sigma, f * (a + m), 0) + blurredEllipseAt(a, b, sigma, 0, f * (b + m))) / 2;
		// the last stop is the box's edge: nothing left, so no seam
		const pc = k === steps ? 0 : Math.round(Math.min(1, p) * 1000) / 10;
		stops.push(`color-mix(in srgb, ${color} ${pc}%, transparent) ${Math.round(f * 1000) / 10}%`);
	}
	return `radial-gradient(closest-side, ${stops.join(', ')})`;
}

export interface CloudOptions {
	/** The blur it replaces, in px. */
	sigma: number;
	/** Seconds for one drift across (it then drifts back), as the old `alternate` animation. */
	dur: number;
	/** Start from the far end (the old `alternate-reverse`). */
	reverse?: boolean;
	/** Drift: from (x0, 0) to (x1, y1) in vw, growing to `grow`. */
	x0?: number;
	x1?: number;
	y1?: number;
	grow?: number;
}

/**
 * Svelte action for a cloud element. The element keeps the ellipse's box; the soft gradient is
 * drawn by its ::before (see the --cloud-bg and --cloud-m custom properties).
 */
export function cloud(node: HTMLElement, o: CloudOptions) {
	let w = 0;
	let h = 0;
	const paint = (nw: number, nh: number) => {
		if (!nw || !nh || (Math.abs(nw - w) < 8 && Math.abs(nh - h) < 8)) return;
		w = nw;
		h = nh;
		node.style.setProperty('--cloud-m', `${spill(o.sigma)}px`);
		node.style.setProperty('--cloud-bg', cloudGradient('var(--cloud-color)', w, h, o.sigma));
	};
	// The size comes from a ResizeObserver: no layout is forced while the page is being built,
	// and a new window size redraws the gradient.
	const ro =
		typeof ResizeObserver === 'function'
			? new ResizeObserver((es) => {
					const box = es[es.length - 1].contentRect;
					paint(box.width, box.height);
				})
			: null;
	if (ro) ro.observe(node);
	else paint(node.offsetWidth, node.offsetHeight);

	// A drift of a few vw over a minute: four steps a second is far below what the eye can see.
	const { x0 = -3, x1 = 4, y1 = 2, grow = 1.08 } = o;
	const stop = slowLoop(node, 4, (t) => {
		const e = wave(t + (o.reverse ? o.dur : 0), o.dur * 2);
		// in vw, as the old keyframes were (and reading the window's size here would force a layout)
		node.style.transform = `translate3d(${(x0 + (x1 - x0) * e).toFixed(3)}vw, ${(y1 * e).toFixed(3)}vw, 0) scale(${(1 + (grow - 1) * e).toFixed(4)})`;
	});
	return {
		destroy() {
			stop();
			ro?.disconnect();
		}
	};
}
