<script lang="ts">
	// The landing's opening picture: fine lines of light grow from you and branch out to your family,
	// each with their real local time. Open people glow (while it's day there); night dims them.
	import { onMount } from 'svelte';
	import { timeIn } from './clock.js';
	import { H, ROOT, SAMPLE_FAMILY, W, grow, nodeState, rng, treeLabel, type TreePerson } from './tree.js';

	let { people = SAMPLE_FAMILY, seed = 7 }: { people?: TreePerson[]; seed?: number } = $props();

	const uid = $props.id();
	const id = (s: string) => `ft${uid}-${s}`;

	const branches = $derived(grow(people, seed));
	const specks = (() => {
		const r = rng(seed + 9);
		return Array.from({ length: 16 }, () => ({ x: 20 + r() * (W - 40), y: 12 + r() * (H - 140), r: 0.6 + r() * 0.8, d: r() * 6 }));
	})();

	let now = $state(new Date());
	let go = $state(false);
	let still = $state(false);
	let el: HTMLElement;

	onMount(() => {
		const mq = matchMedia('(prefers-reduced-motion: reduce)');
		still = mq.matches;
		const onMq = () => (still = mq.matches);
		mq.addEventListener('change', onMq);
		const tick = setInterval(() => (now = new Date()), 20_000);
		// Grow on first view.
		const io = new IntersectionObserver(
			(es) => {
				if (es.some((e) => e.isIntersecting)) {
					go = true;
					io.disconnect();
				}
			},
			{ threshold: 0.2 }
		);
		io.observe(el);
		return () => {
			clearInterval(tick);
			io.disconnect();
			mq.removeEventListener('change', onMq);
		};
	});

	const myTz = typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : 'Asia/Kolkata';
	const label = $derived(treeLabel(people, now));
	// Growth timing: near branches arrive first, far ones a little later.
	const dur = (far: boolean) => (far ? 1.3 : 0.95);
	const delay = (i: number) => 0.05 + (i % 4) * 0.06;
	// People and their labels fade in as their branch is nearly there, so everyone is on screen by about 1.5 s.
	const arrive = (i: number, far: boolean) => delay(i) + dur(far) * 0.7;
	const pct = (v: number, of: number) => `${(v / of) * 100}%`;
</script>

{#snippet strands(kind: 'bloom' | 'main' | 'sheen')}
	{#each branches as b, i (b.person.name)}
		<g mask="url(#{id('m' + i)})">
			{#each b.strands as s, k (k)}
				<path d={s.d} fill={kind === 'sheen' ? `url(#${id('pearl')})` : `url(#${id('g' + s.hue)})`} opacity={s.opacity} />
			{/each}
		</g>
	{/each}
{/snippet}

<figure class="ft" class:go class:still bind:this={el} role="img" aria-label={label}>
	<svg viewBox="0 0 {W} {H}" aria-hidden="true" focusable="false">
		<defs>
			{#each [[0, H, 0, 30], [W, H, 120, 20], [0, H - 20, W - 80, 0]] as [x1, y1, x2, y2], g (g)}
				<linearGradient id={id('g' + g)} gradientUnits="userSpaceOnUse" {x1} {y1} {x2} {y2} spreadMethod="reflect">
					<!-- dawn, bottom to top: peach and coral near you, lilac, then sky blue out at the tips -->
					<stop offset="0.04" class="c4" />
					<stop offset="0.24" class="c3" />
					<stop offset="0.5" class="c2" />
					<stop offset="0.76" class="c1" />
					<stop offset="1" class="c5" />
					{#if !still}
						<animateTransform
							attributeName="gradientTransform"
							type="translate"
							values="0 0; {g === 1 ? -40 : 40} -70; 0 40; 0 0"
							dur="{16 + g * 5}s"
							repeatCount="indefinite"
						/>
					{/if}
				</linearGradient>
			{/each}
			<!-- a pearly highlight band that slides across the lines -->
			<linearGradient id={id('pearl')} gradientUnits="userSpaceOnUse" x1="0" y1={H} x2={W} y2="0">
				<stop offset="0.36" stop-color="#fff" stop-opacity="0" />
				<stop offset="0.5" stop-color="#fff" stop-opacity="0.9" />
				<stop offset="0.64" stop-color="#fff" stop-opacity="0" />
				{#if !still}
					<animateTransform attributeName="gradientTransform" type="translate" values="-620 380; 620 -380" dur="9s" repeatCount="indefinite" />
				{/if}
			</linearGradient>
			<radialGradient id={id('halo')}>
				<stop offset="0" class="halo-0" />
				<stop offset="0.45" class="halo-1" />
				<stop offset="1" class="halo-2" />
			</radialGradient>
			<filter id={id('bloom')} x="-20%" y="-20%" width="140%" height="140%">
				<feGaussianBlur stdDeviation="4" />
			</filter>
			<filter id={id('soft')} x="-50%" y="-50%" width="200%" height="200%">
				<feGaussianBlur stdDeviation="1.6" />
			</filter>
			{#each branches as b, i (b.person.name)}
				<mask id={id('m' + i)} maskUnits="userSpaceOnUse" x="0" y="0" width={W} height={H}>
					<path class="grow" d={b.spine} pathLength="1" style="--dur:{dur(b.far)}s; --del:{delay(i)}s" />
				</mask>
			{/each}
		</defs>

		<g class="specks">
			{#each specks as s, k (k)}
				<circle cx={s.x} cy={s.y} r={s.r} style="--d:{s.d}s" />
			{/each}
		</g>

		<g class="bloom" filter="url(#{id('bloom')})">{@render strands('bloom')}</g>
		<g class="main">{@render strands('main')}</g>
		<g class="sheen">{@render strands('sheen')}</g>

		<!-- light that travels out to whoever is free -->
		{#each branches as b, i (b.person.name)}
			{#if nodeState(b.person, now).glow}
				<path class="pulse" d={b.spine} pathLength="1" style="--del:{delay(i) + dur(b.far) + 0.4 + i * 0.7}s" />
			{/if}
		{/each}

		<g class="root">
			<circle class="halo still-halo" cx={ROOT.x} cy={ROOT.y} r="20" fill="url(#{id('halo')})" />
			<circle class="aura" cx={ROOT.x} cy={ROOT.y} r="7" filter="url(#{id('soft')})" />
			<circle class="dot" cx={ROOT.x} cy={ROOT.y} r="3.8" />
		</g>

		{#each branches as b, i (b.person.name)}
			{@const st = nodeState(b.person, now)}
			<g class="node" class:night={st.night} style="--del:{arrive(i, b.far)}s; --i:{i}">
				{#if st.glow}
					<circle class="halo" cx={b.at.x} cy={b.at.y} r="22" fill="url(#{id('halo')})" />
				{/if}
				<circle class="aura" cx={b.at.x} cy={b.at.y} r="6" filter="url(#{id('soft')})" />
				<circle class="dot" cx={b.at.x} cy={b.at.y} r={st.night ? 2.6 : 3.2} />
			</g>
		{/each}
	</svg>

	<div class="labels" aria-hidden="true">
		<span class="lab below you" style="left:{pct(ROOT.x, W)}; top:{pct(ROOT.y, H)}">
			<b>You</b><small>{timeIn(myTz, now)}</small>
		</span>
		{#each branches as b, i (b.person.name)}
			{@const st = nodeState(b.person, now)}
			<span class="lab {b.label}" class:night={st.night} class:free={st.glow} style="left:{pct(b.at.x, W)}; top:{pct(b.at.y, H)}; --del:{arrive(i, b.far) + 0.05}s">
				<b>{b.person.name}</b><small>{st.time} {b.person.place}</small>
			</span>
		{/each}
	</div>
</figure>

<style>
	.ft {
		/* dawn hues, deepened for light backgrounds so the lines hold up on ivory or a pale sky */
		--ft-1: #4a86c8;
		--ft-2: #7d74c2;
		--ft-3: #d8737c;
		--ft-4: #e39a7c;
		--ft-5: #9a8fd8;
		--ft-dot: #7d74c2;
		--ft-dot-ring: #fff;
		--ft-halo: #9a8fd8;
		--ft-pulse: #fff;
		--ft-bloom: 0.45;
		--ft-sheen: 0.75;
		--ft-speck: #fff;
		--ft-speck-o: 0.55;
		position: relative;
		margin: 0;
		width: 100%;
		aspect-ratio: 560 / 446;
		container-type: inline-size;
		font-family: var(--sans, 'Geist', system-ui, sans-serif);
	}
	@media (prefers-color-scheme: dark) {
		:global(:root:not([data-theme='light'])) .ft {
			--ft-1: #9ec4e6;
			--ft-2: #b7b3d6;
			--ft-3: #e59a9a;
			--ft-4: #f2c3b5;
			--ft-5: #e6e1f0;
			--ft-dot: #f6f3fb;
			--ft-dot-ring: #e6e1f0;
			--ft-halo: #e6e1f0;
			--ft-bloom: 1;
			--ft-sheen: 0.55;
			--ft-speck-o: 0.4;
		}
	}
	:global(:root[data-theme='dark']) .ft {
		--ft-1: #9ec4e6;
		--ft-2: #b7b3d6;
		--ft-3: #e59a9a;
		--ft-4: #f2c3b5;
		--ft-5: #e6e1f0;
		--ft-dot: #f6f3fb;
		--ft-dot-ring: #e6e1f0;
		--ft-halo: #e6e1f0;
		--ft-bloom: 1;
		--ft-sheen: 0.55;
		--ft-speck-o: 0.4;
	}
	svg {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		overflow: visible;
	}
	.c1 {
		stop-color: var(--ft-1);
	}
	.c2 {
		stop-color: var(--ft-2);
	}
	.c3 {
		stop-color: var(--ft-3);
	}
	.c4 {
		stop-color: var(--ft-4);
	}
	.c5 {
		stop-color: var(--ft-5);
	}
	.halo-0 {
		stop-color: var(--ft-halo);
		stop-opacity: 0.95;
	}
	.halo-1 {
		stop-color: var(--ft-halo);
		stop-opacity: 0.35;
	}
	.halo-2 {
		stop-color: var(--ft-halo);
		stop-opacity: 0;
	}

	.bloom {
		opacity: var(--ft-bloom);
	}
	.sheen {
		opacity: var(--ft-sheen);
		mix-blend-mode: screen;
	}

	/* growth: each branch's mask draws along its centre line */
	.grow {
		fill: none;
		stroke: #fff;
		stroke-width: 34;
		stroke-linecap: round;
		stroke-dasharray: 1 1;
		stroke-dashoffset: 1;
		animation: draw var(--dur) cubic-bezier(0.45, 0.05, 0.25, 1) var(--del) forwards paused;
	}
	@keyframes draw {
		to {
			stroke-dashoffset: 0;
		}
	}

	.pulse {
		fill: none;
		stroke: var(--ft-pulse);
		stroke-width: 1.5;
		stroke-linecap: round;
		stroke-dasharray: 0.035 1.2;
		stroke-dashoffset: 0.06;
		opacity: 0;
		animation: travel 5.5s cubic-bezier(0.5, 0, 0.4, 1) var(--del) infinite paused;
	}
	@keyframes travel {
		0% {
			stroke-dashoffset: 0.06;
			opacity: 0;
		}
		8% {
			opacity: 0.95;
		}
		45% {
			opacity: 0.9;
		}
		55%,
		100% {
			stroke-dashoffset: -1;
			opacity: 0;
		}
	}

	.dot {
		fill: var(--ft-dot);
		stroke: var(--ft-dot-ring);
		stroke-width: 1.2;
		stroke-opacity: 0.9;
	}
	.aura {
		fill: var(--ft-halo);
		opacity: 0.7;
	}
	.night .aura {
		display: none;
	}
	.node {
		opacity: 0;
		animation: arrive 0.45s ease var(--del) forwards paused;
	}
	.node.night {
		--to: 0.45;
	}
	.node.night .dot {
		fill: none;
		stroke: var(--ft-2);
	}
	@keyframes arrive {
		to {
			opacity: var(--to, 1);
		}
	}
	.halo {
		transform-box: fill-box;
		transform-origin: center;
		animation: breathe 5s ease-in-out infinite;
		animation-delay: calc(var(--i, 0) * -1.3s);
	}
	.still-halo {
		opacity: 0.8;
	}
	@keyframes breathe {
		0%,
		100% {
			opacity: 0.55;
			transform: scale(0.8);
		}
		50% {
			opacity: 1;
			transform: scale(1.15);
		}
	}
	.specks circle {
		fill: var(--ft-speck);
		opacity: var(--ft-speck-o);
		animation: twinkle 6s ease-in-out infinite;
		animation-delay: calc(var(--d) * -1);
	}
	@keyframes twinkle {
		50% {
			opacity: calc(var(--ft-speck-o) * 0.3);
		}
	}

	.go .grow,
	.go .pulse,
	.go .node,
	.go .lab {
		animation-play-state: running;
	}

	/* labels: real text over the drawing, so they stay crisp and readable at any width */
	.labels {
		position: absolute;
		inset: 0;
		pointer-events: none;
	}
	.lab {
		position: absolute;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 3px;
		white-space: nowrap;
		line-height: 1.1;
		transform: translate(-50%, calc(-100% - 14px));
		opacity: 0;
		animation: arrive 0.5s ease var(--del) forwards paused;
	}
	.lab.below {
		transform: translate(-50%, 14px);
	}
	.lab.you {
		opacity: 1;
		animation: none;
		flex-direction: row;
		align-items: baseline;
		gap: 8px;
		transform: translate(16px, -50%);
	}
	.lab b {
		font-weight: 500;
		font-size: 15px;
		letter-spacing: -0.005em;
		color: var(--text, #141311);
	}
	.lab small {
		font-size: 10.5px;
		font-weight: 450;
		letter-spacing: 0.09em;
		text-transform: uppercase;
		font-variant-numeric: tabular-nums;
		color: var(--text-3, #6b665b);
	}
	.lab.you b {
		font-size: 11px;
		font-weight: 500;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: var(--text-3, #6b665b);
	}
	.lab.night {
		--to: 0.55;
	}
	@container (max-width: 420px) {
		.lab b {
			font-size: 13.5px;
		}
		.lab small {
			font-size: 9.5px;
			letter-spacing: 0.07em;
		}
		.lab {
			transform: translate(-50%, calc(-100% - 10px));
		}
		.lab.below {
			transform: translate(-50%, 10px);
		}
		.lab.you {
			transform: translate(12px, -50%);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.grow,
		.node,
		.lab {
			animation: none;
			stroke-dashoffset: 0;
			opacity: var(--to, 1);
		}
		.pulse {
			display: none;
		}
		.halo,
		.specks circle {
			animation: none;
		}
	}
</style>
