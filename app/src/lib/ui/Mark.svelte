<script lang="ts">
	// The Kizuna mark: two rings tied together. Short bands are cut out of both rings (a mask,
	// so it works on any sky or glass) and one arc is redrawn, so the rings pass over and under. One ring is ink, the other
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
		<mask id="cut-{id}" maskUnits="userSpaceOnUse" x="0" y="0" width="100" height="100">
			<rect x="-20" y="-20" width="140" height="140" fill="#fff" />
			<g transform="rotate(-28 50 50)" fill="none" stroke="#000" stroke-width="13">
				<path d={TOP} />
				<path d={BOTTOM} />
			</g>
		</mask>
	</defs>
	<g fill="none" stroke-width="8">
		<g mask="url(#cut-{id})">
			<g transform="rotate(-28 50 50)">
				<circle cx="37" cy="50" r="20" class="ink" />
				<circle cx="63" cy="50" r="20" class="acc" stroke="url(#dawn-{id})" />
			</g>
		</g>
		<g transform="rotate(-28 50 50)">
			<path d={TOP} class="ink" stroke-linecap="round" />
			<path d={BOTTOM} class="acc" stroke="url(#dawn-{id})" stroke-linecap="round" />
		</g>
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
</style>
