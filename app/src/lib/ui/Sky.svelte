<script lang="ts">
	// The sky every screen sits in, the same as the landing's: dawn in light, dusk in dark,
	// soft blurred clouds that drift very slowly and, at dusk, a few faint stars.
	import { onMount } from 'svelte';
	import { rng } from './strands.js';
	import { cloud } from './clouds.js';
	import { slowLoop, wave } from './slow.js';

	// Seeded, so the stars stay put between screens. Fewer lower down, as near a horizon.
	const r = rng(11);
	const specks = Array.from({ length: 44 }, () => ({
		x: r() * 100,
		y: Math.pow(r(), 1.6) * 92,
		s: 1 + r() * 1.6,
		twinkle: r() < 0.35,
		d: r() * 7
	}));

	// The stars sit in one small drawing; the few that twinkle do so on a slow clock.
	let stars: SVGSVGElement;
	onMount(() =>
		slowLoop(stars, 4, (t) => {
			stars.querySelectorAll<SVGCircleElement>('circle.tw').forEach((c) => {
				c.style.opacity = `calc(var(--star-o) * ${(1 - 0.75 * wave(t + Number(c.dataset.d), 7)).toFixed(3)})`;
			});
		})
	);
</script>

<div class="sky" aria-hidden="true">
	<i class="cloud c1" use:cloud={{ sigma: 70, dur: 60 }}></i>
	<i class="cloud c2" use:cloud={{ sigma: 70, dur: 74, reverse: true }}></i>
	<i class="cloud c3" use:cloud={{ sigma: 70, dur: 86 }}></i>
	<svg class="stars" bind:this={stars} width="100%" height="100%">
		{#each specks as s, k (k)}
			<circle class:tw={s.twinkle} cx="{s.x}%" cy="{s.y}%" r={s.s / 2} data-d={s.d} />
		{/each}
	</svg>
</div>

<style>
	.sky {
		position: fixed;
		inset: 0;
		z-index: -1;
		overflow: hidden;
		pointer-events: none;
		background: var(--app-sky);
	}
	/* The box is the ellipse; ::before draws it blurred (see clouds.ts), so no filter is redrawn. */
	.cloud {
		position: absolute;
		will-change: transform;
	}
	.cloud::before {
		content: '';
		position: absolute;
		inset: calc(-1 * var(--cloud-m, 182px));
		background: var(--cloud-bg, radial-gradient(closest-side, var(--cloud-color), transparent));
	}
	/* high, cool light top left */
	.c1 {
		width: 52vw;
		height: 30vw;
		left: -14vw;
		top: -8vw;
		--cloud-color: var(--cloud-1);
		opacity: 0.75;
	}
	/* a lilac cloud to the right */
	.c2 {
		width: 40vw;
		height: 26vw;
		right: -10vw;
		top: 22vh;
		--cloud-color: var(--cloud-2);
		opacity: 0.55;
	}
	/* the low warm glow, like the light just under the horizon */
	.c3 {
		width: 56vw;
		height: 26vw;
		left: 8vw;
		bottom: -12vw;
		--cloud-color: var(--cloud-3);
		opacity: 0.6;
	}
	.sky {
		--cloud-1: rgb(255 255 255 / 0.85);
		--cloud-2: rgb(196 186 230 / 0.7);
		--cloud-3: rgb(244 190 170 / 0.7);
	}
	.stars {
		position: absolute;
		inset: 0;
		overflow: visible;
		opacity: 0.35;
	}
	.stars circle {
		fill: var(--star);
		opacity: var(--star-o);
	}
	@media (prefers-color-scheme: dark) {
		:global(:root:not([data-theme='light'])) .sky {
			--cloud-1: rgb(64 88 140 / 0.36);
			--cloud-2: rgb(120 96 150 / 0.45);
			--cloud-3: rgb(150 92 76 / 0.42);
		}
		:global(:root:not([data-theme='light'])) .stars {
			opacity: 1;
		}
	}
	:global(:root[data-theme='dark']) .sky {
		--cloud-1: rgb(64 88 140 / 0.36);
		--cloud-2: rgb(120 96 150 / 0.45);
		--cloud-3: rgb(150 92 76 / 0.42);
	}
	:global(:root[data-theme='dark']) .stars {
		opacity: 1;
	}
</style>
