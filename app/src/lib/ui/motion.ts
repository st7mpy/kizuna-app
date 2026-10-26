// One shared motion: a short, soft fade-and-lift. Respects reduced motion.
import { cubicOut } from 'svelte/easing';

const reduced = () =>
	typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export function soft(_node: Element, { y = 8, duration = 240 }: { y?: number; duration?: number } = {}) {
	if (reduced()) return { duration: 0 };
	return {
		duration,
		easing: cubicOut,
		css: (t: number) => `opacity:${t};transform:translateY(${(1 - t) * y}px)`
	};
}

/** Collapse height too, so the cards below slide up gently. */
export function fold(node: Element, { duration = 280 }: { duration?: number } = {}) {
	if (reduced()) return { duration: 0 };
	const h = (node as HTMLElement).offsetHeight;
	return {
		duration,
		easing: cubicOut,
		css: (t: number) =>
			`opacity:${t};height:${t * h}px;transform:scale(${0.97 + 0.03 * t});overflow:hidden;margin-bottom:${(t - 1) * 12}px`
	};
}
