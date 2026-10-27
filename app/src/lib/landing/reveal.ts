// Adds `shown` to an element the first time it scrolls into view. Without IntersectionObserver,
// or with reduced motion, it shows at once.
export function reveal(node: HTMLElement, delay = 0) {
	node.style.setProperty('--d', `${delay}ms`);
	const still =
		typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
	if (still || typeof IntersectionObserver === 'undefined') {
		node.classList.add('shown');
		return {};
	}
	node.classList.add('rv');
	const io = new IntersectionObserver(
		(entries) => {
			for (const e of entries) {
				if (e.isIntersecting) {
					node.classList.add('shown');
					io.disconnect();
				}
			}
		},
		{ rootMargin: '0px 0px -8% 0px', threshold: 0.12 }
	);
	io.observe(node);
	return { destroy: () => io.disconnect() };
}
