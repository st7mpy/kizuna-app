<script lang="ts">
	// The Kizuna mark: two rings tied together. Short arcs are redrawn over a band of the
	// page colour so the rings pass over and under each other. One ring is ink, the other
	// carries the dawn colours of the family tree.
	let { size = 28, title = '' }: { size?: number; title?: string } = $props();
	const id = $props.id();
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
	<defs>
		<linearGradient id="dawn-{id}" x1="40" y1="30" x2="86" y2="72" gradientUnits="userSpaceOnUse">
			<stop offset="0" stop-color="#4f86d4" />
			<stop offset="0.5" stop-color="#7d6fc8" />
			<stop offset="1" stop-color="#d9706c" />
		</linearGradient>
	</defs>
	<g transform="rotate(-28 50 50)" fill="none" stroke-width="8">
		<circle cx="37" cy="50" r="20" class="ink" />
		<circle cx="63" cy="50" r="20" class="acc" stroke="url(#dawn-{id})" />
		<path d={TOP} class="paper" stroke-width="13" />
		<path d={TOP} class="ink" stroke-linecap="round" />
		<path d={BOTTOM} class="paper" stroke-width="13" />
		<path d={BOTTOM} class="acc" stroke="url(#dawn-{id})" stroke-linecap="round" />
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
	.paper {
		stroke: var(--mark-paper, var(--bg));
	}
</style>
