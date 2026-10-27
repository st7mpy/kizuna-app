// A slow clock for the ambient effects that never end (shimmer on the lines, breathing glows,
// drifting clouds, twinkling stars). They move so gently that a dozen updates a second looks the
// same as sixty, and the page then sits still between ticks instead of repainting every frame.
// It only runs while its element is on screen, the tab is visible and motion is allowed.

// While the page scrolls the ambient effects hold still, so every frame goes to the scroll.
let quietUntil = 0;
if (typeof window !== 'undefined')
	addEventListener('scroll', () => (quietUntil = performance.now() + 200), { passive: true, capture: true });

const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Calls `tick(seconds)` about `fps` times a second (aligned to a frame) while `el` is in view.
 * Use multiples of 4 (4, 16, 20) so the ticks of different effects land on the same frames.
 * Returns a stop function. With reduced motion it never ticks.
 */
export function slowLoop(el: Element, fps: number, tick: (t: number) => void): () => void {
	if (typeof window === 'undefined' || reduced()) return () => {};
	const every = 1000 / fps;
	const t0 = performance.now();
	let inView = true;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let frame = 0;
	let stopped = false;

	const run = () => {
		timer = undefined;
		frame = requestAnimationFrame((now) => {
			frame = 0;
			if (stopped || !inView || document.hidden) return;
			// hold still while scrolling, and under an open sheet (its blurred backdrop would redraw)
			if (performance.now() >= quietUntil && !document.querySelector('dialog[open]')) tick((now - t0) / 1000);
			schedule();
		});
	};
	const schedule = () => {
		// Ticks sit on a shared grid (multiples of the period since the page opened), so every slow
		// effect on screen updates in the same frame instead of each waking the page on its own.
		if (!stopped && inView && !document.hidden && timer === undefined && !frame) {
			const wait = every - (performance.now() % every);
			timer = setTimeout(run, wait < 4 ? wait + every : wait);
		}
	};
	const io =
		typeof IntersectionObserver === 'function'
			? new IntersectionObserver((es) => {
					inView = es.some((e) => e.isIntersecting);
					schedule();
				})
			: null;
	io?.observe(el);
	const onVis = () => schedule();
	document.addEventListener('visibilitychange', onVis);
	tick(0);
	schedule();
	return () => {
		stopped = true;
		clearTimeout(timer);
		cancelAnimationFrame(frame);
		io?.disconnect();
		document.removeEventListener('visibilitychange', onVis);
	};
}

/** A smooth 0..1..0 wave with period `p` seconds (ease-in-out, like the CSS keyframes it replaces). */
export function wave(t: number, p: number): number {
	return 0.5 - 0.5 * Math.cos((2 * Math.PI * t) / p);
}
