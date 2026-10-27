// A textarea that grows with its words (up to a cap), so a long line is never cut mid-sentence.
// Pass the bound value so a line set from code (a draft arriving) also resizes it.
export function autogrow(node: HTMLTextAreaElement, _value?: string) {
	let lastWidth = 0;
	function fit() {
		if (!node.isConnected || node.clientWidth === 0) return; // hidden (a closed sheet): wait
		const max = Math.max(160, Math.round(window.innerHeight * 0.45));
		node.style.height = 'auto'; // back to the rows height, then measure
		const edge = node.offsetHeight - node.clientHeight; // borders
		const want = node.scrollHeight + edge;
		node.style.height = `${Math.min(want, max)}px`;
		node.style.overflowY = want > max ? 'auto' : 'hidden';
	}
	const ro =
		typeof ResizeObserver === 'undefined'
			? null
			: new ResizeObserver(() => {
					// only width changes matter (a sheet opening, rotating the phone)
					if (node.clientWidth !== lastWidth) {
						lastWidth = node.clientWidth;
						fit();
					}
				});
	ro?.observe(node);
	node.addEventListener('input', fit);
	fit();
	return {
		update() {
			if (typeof requestAnimationFrame === 'function') requestAnimationFrame(fit);
			else queueMicrotask(fit);
		},
		destroy() {
			ro?.disconnect();
			node.removeEventListener('input', fit);
		}
	};
}
