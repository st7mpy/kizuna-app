<script lang="ts">
	// The sky every screen sits in, the same as the landing's: dawn in light, dusk in dark,
	// soft blurred clouds that drift very slowly and, at dusk, a few faint stars.
	import { rng } from './strands.js';

	// Seeded, so the stars stay put between screens. Fewer lower down, as near a horizon.
	const r = rng(11);
	const specks = Array.from({ length: 44 }, () => ({
		x: r() * 100,
		y: Math.pow(r(), 1.6) * 92,
		s: 1 + r() * 1.6,
		twinkle: r() < 0.35,
		d: r() * 7
	}));
</script>

<div class="sky" aria-hidden="true">
	<i class="cloud c1"></i>
	<i class="cloud c2"></i>
	<i class="cloud c3"></i>
	<div class="stars">
		{#each specks as s, k (k)}
			<b class:tw={s.twinkle} style="left:{s.x}%; top:{s.y}%; width:{s.s}px; height:{s.s}px; --d:{s.d}s"></b>
		{/each}
	</div>
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
	.cloud {
		position: absolute;
		border-radius: 50%;
		filter: blur(70px);
		animation: drift 60s ease-in-out infinite alternate;
	}
	/* high, cool light top left */
	.c1 {
		width: 52vw;
		height: 30vw;
		left: -14vw;
		top: -8vw;
		background: var(--cloud-1);
		opacity: 0.75;
	}
	/* a lilac cloud to the right */
	.c2 {
		width: 40vw;
		height: 26vw;
		right: -10vw;
		top: 22vh;
		background: var(--cloud-2);
		opacity: 0.55;
		animation-duration: 74s;
		animation-direction: alternate-reverse;
	}
	/* the low warm glow, like the light just under the horizon */
	.c3 {
		width: 56vw;
		height: 26vw;
		left: 8vw;
		bottom: -12vw;
		background: var(--cloud-3);
		opacity: 0.6;
		animation-duration: 86s;
	}
	.sky {
		--cloud-1: rgb(255 255 255 / 0.85);
		--cloud-2: rgb(196 186 230 / 0.7);
		--cloud-3: rgb(244 190 170 / 0.7);
	}
	.stars {
		position: absolute;
		inset: 0;
		opacity: 0.35;
	}
	.stars b {
		position: absolute;
		border-radius: 50%;
		background: var(--star);
		opacity: var(--star-o);
	}
	.stars b.tw {
		animation: twinkle 7s ease-in-out infinite;
		animation-delay: calc(var(--d) * -1);
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
	@keyframes drift {
		from {
			transform: translate3d(-3vw, 0, 0) scale(1);
		}
		to {
			transform: translate3d(4vw, 2vw, 0) scale(1.08);
		}
	}
	@keyframes twinkle {
		50% {
			opacity: calc(var(--star-o) * 0.25);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.cloud,
		.stars b.tw {
			animation: none;
		}
	}
</style>
