<script lang="ts">
	// The Kizuna mark: two rings tied together. Short arcs are redrawn over a band of the
	// page colour so the rings pass over and under each other.
	let { size = 28, title = '' }: { size?: number; title?: string } = $props();
	const TOP = 'M43.36 31.04 A20 20 0 0 1 54.75 40.78';
	const BOTTOM = 'M56.64 68.96 A20 20 0 0 1 45.25 59.22';
</script>

<svg
	width={size}
	height={size}
	viewBox="0 0 100 100"
	role={title ? 'img' : undefined}
	aria-hidden={title ? undefined : 'true'}
	aria-label={title || undefined}
>
	<g transform="rotate(-28 50 50)" fill="none" stroke-width="8">
		<circle cx="37" cy="50" r="20" class="ink" />
		<circle cx="63" cy="50" r="20" class="acc" />
		<path d={TOP} class="paper" stroke-width="13" />
		<path d={TOP} class="ink" stroke-linecap="round" />
		<path d={BOTTOM} class="paper" stroke-width="13" />
		<path d={BOTTOM} class="acc" stroke-linecap="round" />
	</g>
</svg>

<style>
	svg {
		display: block;
		flex: none;
	}
	.ink {
		stroke: currentColor;
	}
	.acc {
		stroke: var(--accent);
	}
	.paper {
		stroke: var(--mark-paper, var(--bg));
	}
</style>
