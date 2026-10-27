<script lang="ts">
	// A small round mark in dawn colours, pressed once when you poke someone.
	let { size = 72 }: { size?: number } = $props();
	const id = $props.id();
</script>

<svg class="seal" width={size} height={size} viewBox="0 0 100 100" aria-hidden="true">
	<defs>
		<linearGradient id="dawn-{id}" x1="0" y1="0" x2="1" y2="1">
			<stop offset="0" stop-color="#8fb6e2" />
			<stop offset="0.5" stop-color="#a99fd6" />
			<stop offset="1" stop-color="#e79c95" />
		</linearGradient>
		<filter id="ink-{id}" x="-10%" y="-10%" width="120%" height="120%">
			<feTurbulence type="fractalNoise" baseFrequency="0.8" numOctaves="2" seed="7" result="noise" />
			<feColorMatrix in="noise" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -0.8 1.5" result="mask" />
			<feComposite in="SourceGraphic" in2="mask" operator="in" />
		</filter>
		<filter id="edge-{id}">
			<feTurbulence type="fractalNoise" baseFrequency="0.05" numOctaves="2" seed="11" />
			<feDisplacementMap in="SourceGraphic" scale="3.5" />
		</filter>
	</defs>
	<g filter="url(#edge-{id})">
		<g filter="url(#ink-{id})">
			<circle cx="50" cy="50" r="46" fill="url(#dawn-{id})" />
			<circle cx="50" cy="50" r="39" fill="none" stroke="#fffcf6" stroke-width="2" />
			<g transform="rotate(-28 50 50)" fill="none" stroke="#fffcf6" stroke-width="5.5">
				<circle cx="41" cy="50" r="13" />
				<circle cx="59" cy="50" r="13" />
			</g>
		</g>
	</g>
</svg>

<style>
	.seal {
		display: block;
		flex: none;
		transform: rotate(-8deg);
		animation: press 520ms cubic-bezier(0.2, 0.9, 0.25, 1.15) both;
	}
	@keyframes press {
		0% {
			opacity: 0;
			transform: scale(1.5) rotate(-18deg);
		}
		60% {
			opacity: 1;
			transform: scale(0.96) rotate(-7deg);
		}
		100% {
			opacity: 1;
			transform: scale(1) rotate(-8deg);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.seal {
			animation: none;
		}
	}
</style>
