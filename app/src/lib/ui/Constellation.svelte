<script lang="ts" module>
	/** What a dot needs. Matches MapPerson from the map view. */
	export interface DotPerson {
		person: { id: string; name: string };
		ring: 'inner' | 'outer';
		tz: string | null;
		localTime: string | null;
		daylight: number;
		glow: 'open' | 'maybe' | null;
		occasion: { name: string; kind: string } | null;
		hasGift: boolean;
		hasNotes: boolean;
	}
</script>

<script lang="ts">
	// The Kizuna map: a calm constellation. You in the centre, family on the inner ring, friends
	// outside, and fine lines of light from you to each of them (the same lines as the landing).
	// No location: only names, local time, daylight and whether someone is open to a call.
	// On load the lines draw out from you, then each dot lights up in turn; open people keep a
	// slow breathing glow, and a faint light travels out along the lines when the circle refreshes.
	import { onMount } from 'svelte';
	import { hueFor } from './hue.js';
	import { beam, cityOf, DOT_R, dotLabel, layoutConstellation, shortName } from './constellation.js';

	let {
		people,
		me,
		beat = 0,
		lit = []
	}: {
		people: DotPerson[];
		me: { name: string; localTime: string };
		/** Goes up each time the circle refreshes: sends a faint pulse out along the lines. */
		beat?: number;
		/** People who just answered: their dot flares (again whenever the list changes). */
		lit?: string[];
	} = $props();
	const litSet = $derived(new Set(lit));
	const litKey = $derived(lit.join('|'));

	const shown = $derived(people.slice(0, 8));
	const byId = $derived(new Map(shown.map((p) => [p.person.id, p])));
	const layout = $derived(
		layoutConstellation(
			shown.map((p) => ({
				id: p.person.id,
				ring: p.ring,
				name: shortName(p.person.name),
				sub: sub(p)
			}))
		)
	);
	const centre = $derived({ x: layout.cx, y: layout.cy });
	const beams = $derived(new Map(layout.dots.map((d) => [d.id, beam(centre, d, d.id)])));
	// Light up in turn, clockwise from the top.
	const order = $derived(
		new Map(
			[...layout.dots]
				.sort((a, b) => beams.get(a.id)!.turn - beams.get(b.id)!.turn)
				.map((d, i) => [d.id, i])
		)
	);
	const reach = $derived(Math.max(60, ...layout.dots.map((d) => Math.hypot(d.x - layout.cx, d.y - layout.cy))) + 14);
	const uid = $props.id();

	// Timing (seconds): lines draw out together, a touch staggered; then the dots light one by one.
	const DRAW = 1.0;
	const drawDelay = (i: number) => 0.15 + i * 0.07;
	const litAt = (i: number) => 0.15 + DRAW * 0.8 + i * 0.16;
	const introEnd = $derived(litAt(Math.max(0, layout.dots.length - 1)) + 0.6);

	let still = $state(false);
	let born = 0;
	onMount(() => {
		born = performance.now();
		const mq = matchMedia('(prefers-reduced-motion: reduce)');
		still = mq.matches;
		const onMq = () => (still = mq.matches);
		mq.addEventListener('change', onMq);
		return () => mq.removeEventListener('change', onMq);
	});
	// A refresh during the intro waits for it to finish.
	const pulseWait = $derived.by(() => {
		void beat;
		const since = born ? (performance.now() - born) / 1000 : 0;
		return Math.max(0, introEnd - since);
	});

	function sub(p: DotPerson): string {
		if (!p.localTime) return '';
		const city = cityOf(p.tz);
		return city ? `${p.localTime} ${city}` : p.localTime;
	}
	const gid = (id: string) => `g-${uid}-${id.replace(/[^A-Za-z0-9_-]/g, '')}`;
	const iri = (k: number) => `iri${k}-${uid}`;
</script>

{#snippet strands(kind: 'bloom' | 'main' | 'sheen')}
	{#each layout.dots as d (d.id)}
		<g mask="url(#m-{gid(d.id)})">
			{#each beams.get(d.id)!.strands as s, k (k)}
				<path d={s.d} fill={kind === 'sheen' ? `url(#pearl-${uid})` : `url(#${iri(s.hue)})`} opacity={s.opacity} />
			{/each}
		</g>
	{/each}
{/snippet}

<figure class="map" class:still aria-label="Your Kizuna map">
	<svg viewBox="0 {layout.top} {layout.width} {layout.bottom - layout.top}" width="100%" role="group" aria-label="People on your map">
		<defs>
			<!-- dawn, from you outward: peach and coral near you, lilac, then sky blue out at the dots -->
			{#each [[0.04, 0.22, 0.5, 0.78, 1], [0.0, 0.3, 0.6, 0.85, 1], [0.08, 0.18, 0.42, 0.7, 0.95]] as st, k (k)}
				<radialGradient id={iri(k)} gradientUnits="userSpaceOnUse" cx={layout.cx} cy={layout.cy} r={reach * (k === 2 ? 0.85 : 1)} spreadMethod="reflect">
					<stop offset={st[0]} class="c4" />
					<stop offset={st[1]} class="c3" />
					<stop offset={st[2]} class="c2" />
					<stop offset={st[3]} class="c1" />
					<stop offset={st[4]} class="c5" />
					{#if !still}
						<animate attributeName="r" values="{reach};{reach * (1.14 + k * 0.05)};{reach}" dur="{14 + k * 5}s" repeatCount="indefinite" />
					{/if}
				</radialGradient>
			{/each}
			<!-- a pearly band that slides slowly across the lines -->
			<linearGradient id="pearl-{uid}" gradientUnits="userSpaceOnUse" x1="0" y1={layout.bottom} x2={layout.width} y2={layout.top}>
				<stop offset="0.38" stop-color="#fff" stop-opacity="0" />
				<stop offset="0.5" stop-color="#fff" stop-opacity="0.85" />
				<stop offset="0.62" stop-color="#fff" stop-opacity="0" />
				{#if !still}
					<animateTransform attributeName="gradientTransform" type="translate" values="-420 300; 420 -300" dur="11s" repeatCount="indefinite" />
				{/if}
			</linearGradient>
			<radialGradient id="halo-{uid}">
				<stop offset="0" class="halo-0" />
				<stop offset="0.45" class="halo-1" />
				<stop offset="1" class="halo-2" />
			</radialGradient>
			<filter id="bloom-{uid}" x="-20%" y="-20%" width="140%" height="140%">
				<feGaussianBlur stdDeviation="3" />
			</filter>
			<filter id="soft-{uid}" x="-80%" y="-80%" width="260%" height="260%">
				<feGaussianBlur stdDeviation="2.4" />
			</filter>
			{#each layout.dots as d (d.id)}
				{@const i = order.get(d.id) ?? 0}
				<mask id="m-{gid(d.id)}" maskUnits="userSpaceOnUse" x="0" y={layout.top} width={layout.width} height={layout.bottom - layout.top}>
					<path class="grow" d={beams.get(d.id)!.spine} pathLength="1" style="--del:{drawDelay(i)}s; --dur:{DRAW}s" />
					<!-- lines pass behind the labels, never through them -->
					<rect x={layout.cx - 34} y={layout.cy + 16} width="68" height="15" rx="7" fill="#000" filter="url(#soft-{uid})" />
					{#each layout.dots as o (o.id)}
						<rect x={o.label.x - 2} y={o.label.y + 3} width={o.label.w + 4} height={o.label.h - 4} rx="6" fill="#000" filter="url(#soft-{uid})" />
					{/each}
				</mask>
				<clipPath id="c-{gid(d.id)}"><circle cx={d.x} cy={d.y} r={DOT_R} /></clipPath>
			{/each}
			{#each shown as p (p.person.id)}
				{@const hue = hueFor(p.person.id)}
				<radialGradient id={gid(p.person.id)}>
					<stop offset="0%" stop-color={hue} stop-opacity="0.8" />
					<stop offset="55%" stop-color={hue} stop-opacity="0.28" />
					<stop offset="100%" stop-color={hue} stop-opacity="0" />
				</radialGradient>
				<!-- a lit orb: pale at the centre, the person's colour at the rim -->
				<radialGradient id="orb-{gid(p.person.id)}" cx="0.42" cy="0.38" r="0.7">
					<stop offset="0%" stop-color="#fffdf8" />
					<stop offset="45%" stop-color={hue} stop-opacity="0.95" />
					<stop offset="100%" stop-color={hue} />
				</radialGradient>
			{/each}
		</defs>

		{#each layout.rings as r, i (i)}
			<ellipse
				class="ring"
				class:outer={i === layout.rings.length - 1 && layout.rings.length > 1}
				cx={layout.cx}
				cy={layout.cy}
				rx={r.rx}
				ry={r.ry}
			/>
		{/each}

		<g class="beams" aria-hidden="true">
			<g class="bloom" filter="url(#bloom-{uid})">{@render strands('bloom')}</g>
			<g class="main">{@render strands('main')}</g>
			<g class="sheen">{@render strands('sheen')}</g>
			{#if beat > 0 && !still}
				{#key beat}
					{#each layout.dots as d (d.id)}
						<path class="pulse" d={beams.get(d.id)!.spine} pathLength="1" style="--del:{pulseWait + (order.get(d.id) ?? 0) * 0.12}s" />
					{/each}
				{/key}
			{/if}
		</g>

		<!-- you -->
		<g class="me" aria-label="You, {me.localTime}" role="img">
			<circle class="halo me-halo" cx={layout.cx} cy={layout.cy} r="20" fill="url(#halo-{uid})" />
			<circle class="aura" cx={layout.cx} cy={layout.cy} r="7" filter="url(#soft-{uid})" />
			<circle class="core" cx={layout.cx} cy={layout.cy} r="4.4" />
			<text x={layout.cx} y={layout.cy + 26} text-anchor="middle" class="me-name"
				>{me.name || 'You'}<tspan class="me-time num" dx="7">{me.localTime}</tspan></text
			>
		</g>

		{#each layout.dots as d (d.id)}
			{@const p = byId.get(d.id)!}
			{@const hue = hueFor(d.id)}
			{@const i = order.get(d.id) ?? 0}
			<a
				href="/circle/{d.id}"
				class="dotlink"
				aria-label={dotLabel({
					name: p.person.name,
					localTime: p.localTime,
					tz: p.tz,
					glow: p.glow,
					occasion: p.occasion,
					hasGift: p.hasGift
				})}
			>
				<rect class="hit" x={d.x - 24} y={d.y - 24} width="48" height="48" rx="24" />
				<rect class="hit" x={d.label.x} y={d.label.y} width={d.label.w} height={d.label.h} />
				<g class="node" style="--lit:{litAt(i)}s; --i:{i}">
					{#if p.glow === 'open'}
						<circle class="halo open" cx={d.x} cy={d.y} r={DOT_R * 2.6} fill="url(#{gid(d.id)})" />
					{:else if p.glow === 'maybe'}
						<circle class="halo maybe" cx={d.x} cy={d.y} r={DOT_R * 2} fill="url(#{gid(d.id)})" />
					{/if}
					<circle class="flare" cx={d.x} cy={d.y} r={DOT_R * 1.6} fill="url(#halo-{uid})" />
					{#if litSet.has(d.id)}
						{#key litKey}
							<!-- they just answered: a brighter flare after the intro, twice -->
							<circle class="answered" cx={d.x} cy={d.y} r={DOT_R * 2.2} fill="url(#halo-{uid})" style="--at:{pulseWait}s" />
						{/key}
					{/if}
					<circle class="glowring" cx={d.x} cy={d.y} r={DOT_R + 2.5} fill={hue} filter="url(#soft-{uid})" />
					<circle class="focus" cx={d.x} cy={d.y} r={DOT_R + 5} />
					<circle class="dot" cx={d.x} cy={d.y} r={DOT_R} fill="url(#orb-{gid(d.id)})" stroke={hue} />
					{#if p.daylight < 0.98}
						<!-- night falls across the dot like a moon phase -->
						<circle
							class="shade"
							cx={d.x + 2 * DOT_R * Math.max(0, Math.min(1, p.daylight))}
							cy={d.y}
							r={DOT_R}
							clip-path="url(#c-{gid(d.id)})"
						/>
						<circle class="night" cx={d.x} cy={d.y} r={DOT_R - 0.5} />
					{/if}

					<!-- small marks, never counts -->
					{#if p.occasion}
						<g transform="translate({d.x + 13} {d.y - 14})" class="mark">
							{#if p.occasion.kind === 'birthday'}
								<!-- cake -->
								<rect x="-4.5" y="-1" width="9" height="5" rx="1" class="ink-fill" />
								<line x1="0" y1="-1" x2="0" y2="-4" class="ink-line" />
								<circle cx="0" cy="-5.2" r="1.3" class="flame" />
							{:else if p.occasion.kind === 'festival'}
								<!-- a small star for a shared holiday -->
								<path d="M0 -5.5 L1.3 -1.3 L5.5 0 L1.3 1.3 L0 5.5 L-1.3 1.3 L-5.5 0 L-1.3 -1.3 Z" class="flame" />
							{:else}
								<circle r="2.6" class="ink-fill" />
							{/if}
						</g>
					{/if}
					{#if p.hasGift}
						<!-- ribbon -->
						<g transform="translate({d.x - 14} {d.y - 14})" class="mark">
							<path d="M0 0 L-4 -3 L-4 3 Z M0 0 L4 -3 L4 3 Z" class="ink-fill" />
							<path d="M0 0 L-2.5 5 M0 0 L2.5 5" class="ink-line" />
						</g>
					{/if}
					{#if p.hasNotes}
						<!-- leaf: you have private notes about them -->
						<g transform="translate({d.x + 14} {d.y + 13}) rotate(-35)" class="mark">
							<path d="M-4.5 0 Q0 -4 4.5 0 Q0 4 -4.5 0 Z" class="leaf" />
							<line x1="-4.5" y1="0" x2="3" y2="0" class="leaf-vein" />
						</g>
					{/if}

					<text x={d.tx} y={d.label.y + 17} text-anchor={d.anchor} class="name">{shortName(p.person.name)}</text>
					{#if sub(p)}
						<text x={d.tx} y={d.label.y + 32} text-anchor={d.anchor} class="sub num">{sub(p)}</text>
					{/if}
				</g>
			</a>
		{/each}
	</svg>
</figure>

<style>
	.map {
		/* the landing's line colours: deepened on a pale dawn, pale and glowing at dusk */
		--c-bloom: 0.55;
		--c-sheen: 0.7;
		--c-halo: #9a8fd8;
		--c-core: #ffffff;
		--c-core-ring: #9a8fd8;
		--c-pulse: #ffffff;
		--c-shade: var(--bg);
		margin: 0 auto;
		width: 100%;
		max-width: var(--map-w, 430px);
	}
	@media (prefers-color-scheme: dark) {
		:global(:root:not([data-theme='light'])) .map {
			--c-bloom: 1;
			--c-sheen: 0.5;
			--c-halo: #e6e1f0;
			--c-core: #f6f3fb;
			--c-core-ring: #e6e1f0;
			--c-shade: #10121c;
		}
	}
	:global(:root[data-theme='dark']) .map {
		--c-bloom: 1;
		--c-sheen: 0.5;
		--c-halo: #e6e1f0;
		--c-core: #f6f3fb;
		--c-core-ring: #e6e1f0;
		--c-shade: #10121c;
	}
	svg {
		display: block;
		overflow: visible;
	}
	/* On a wide screen a full, tall map still fits beside the list without scrolling. */
	@media (min-width: 1100px) {
		svg {
			max-height: var(--map-max-h, none);
		}
	}
	.c1 {
		stop-color: var(--iri-1);
	}
	.c2 {
		stop-color: var(--iri-2);
	}
	.c3 {
		stop-color: var(--iri-3);
	}
	.c4 {
		stop-color: var(--iri-4);
	}
	.c5 {
		stop-color: var(--iri-5);
	}
	.halo-0 {
		stop-color: var(--c-halo);
		stop-opacity: 0.95;
	}
	.halo-1 {
		stop-color: var(--c-halo);
		stop-opacity: 0.35;
	}
	.halo-2 {
		stop-color: var(--c-halo);
		stop-opacity: 0;
	}
	.ring {
		fill: none;
		stroke: var(--line);
		stroke-width: 1;
		stroke-dasharray: 1 5;
		stroke-linecap: round;
		vector-effect: non-scaling-stroke;
	}
	.ring.outer {
		stroke-dasharray: 1 8;
	}

	.beams {
		pointer-events: none;
	}
	.bloom {
		opacity: var(--c-bloom);
	}
	.sheen {
		opacity: var(--c-sheen);
		mix-blend-mode: screen;
	}
	/* growth: each beam's mask draws out from you along its centre line */
	.grow {
		fill: none;
		stroke: #fff;
		stroke-width: 18;
		stroke-linecap: round;
		stroke-dasharray: 1 1;
		stroke-dashoffset: 1;
		animation: draw var(--dur) cubic-bezier(0.45, 0.05, 0.25, 1) var(--del) forwards;
	}
	@keyframes draw {
		to {
			stroke-dashoffset: 0;
		}
	}
	/* a faint light that travels out along each line when the circle refreshes */
	.pulse {
		fill: none;
		stroke: var(--c-pulse);
		stroke-width: 1.6;
		stroke-linecap: round;
		stroke-dasharray: 0.06 1.2;
		stroke-dashoffset: 0.06;
		opacity: 0;
		animation: travel 2.4s cubic-bezier(0.5, 0, 0.4, 1) var(--del) both;
	}
	@keyframes travel {
		0% {
			stroke-dashoffset: 0.06;
			opacity: 0;
		}
		12% {
			opacity: 0.9;
		}
		75% {
			opacity: 0.7;
		}
		100% {
			stroke-dashoffset: -1;
			opacity: 0;
		}
	}

	.me-halo {
		opacity: 0.85;
	}
	.aura {
		fill: var(--c-halo);
		opacity: 0.75;
	}
	.core {
		fill: var(--c-core);
		stroke: var(--c-core-ring);
		stroke-width: 1.2;
	}
	.me-name {
		font-family: var(--sans);
		font-size: 9.5px;
		font-weight: 500;
		letter-spacing: 0.14em;
		text-transform: uppercase;
		fill: var(--text-3);
	}
	.me-time {
		letter-spacing: 0.08em;
	}
	.name {
		font-family: var(--sans);
		font-size: 15px;
		font-weight: 500;
		letter-spacing: -0.005em;
		fill: var(--text);
	}
	.sub {
		font-family: var(--sans);
		font-size: 9px;
		font-weight: 450;
		letter-spacing: 0.07em;
		text-transform: uppercase;
		fill: var(--text-3);
		font-variant-numeric: tabular-nums;
	}
	.dotlink {
		cursor: pointer;
		outline: none;
	}
	.hit {
		fill: transparent;
	}

	/* each person waits as a faint point, then lights up in turn */
	.node {
		opacity: 0.12;
		animation: light 0.7s ease-out var(--lit) forwards;
	}
	@keyframes light {
		to {
			opacity: 1;
		}
	}
	.flare {
		opacity: 0;
		transform-box: fill-box;
		transform-origin: center;
		pointer-events: none;
		animation: flare 1.2s ease-out var(--lit) both;
	}
	@keyframes flare {
		0% {
			opacity: 0;
			transform: scale(0.4);
		}
		20% {
			opacity: 0.9;
		}
		100% {
			opacity: 0;
			transform: scale(1.7);
		}
	}
	.answered {
		opacity: 0;
		transform-box: fill-box;
		transform-origin: center;
		pointer-events: none;
		animation: flare 1.4s ease-out var(--at, 0s) 2 both;
	}
	.glowring {
		opacity: 0.55;
		pointer-events: none;
	}
	.dot {
		stroke-width: 1;
		stroke-opacity: 0.9;
	}
	.shade {
		fill: var(--c-shade);
		fill-opacity: 0.6;
		pointer-events: none;
	}
	.night {
		fill: none;
		stroke: var(--text-3);
		stroke-width: 0.75;
		stroke-opacity: 0.6;
	}
	.focus {
		fill: none;
		stroke: var(--accent);
		stroke-width: 2;
		opacity: 0;
	}
	.dotlink:focus-visible .focus {
		opacity: 1;
	}
	.dotlink:focus-visible .name {
		text-decoration: underline;
	}
	.dotlink:hover .glowring {
		opacity: 0.9;
	}
	.halo {
		transform-box: fill-box;
		transform-origin: center;
		pointer-events: none;
	}
	/* open to a call: a slow breathing glow that starts once they have lit up */
	.halo.open {
		animation: breathe 4.8s ease-in-out calc(var(--lit) + 0.5s) infinite both;
	}
	.halo.maybe {
		opacity: 0.55;
	}
	@keyframes breathe {
		0%,
		100% {
			opacity: 0.7;
			transform: scale(0.86);
		}
		50% {
			opacity: 1;
			transform: scale(1.1);
		}
	}
	.mark {
		pointer-events: none;
	}
	.ink-fill {
		fill: var(--text-2);
	}
	.ink-line {
		stroke: var(--text-2);
		stroke-width: 1.2;
		fill: none;
		stroke-linecap: round;
	}
	.flame {
		fill: #e39a62;
	}
	.leaf {
		fill: none;
		stroke: var(--text-3);
		stroke-width: 1.1;
	}
	.leaf-vein {
		stroke: var(--text-3);
		stroke-width: 0.8;
	}

	/* reduced motion: everything is simply there, lit, with no drift or breathing */
	.still .grow {
		animation: none;
		stroke-dashoffset: 0;
	}
	.still .node,
	.still .flare,
	.still .answered,
	.still .halo.open {
		animation: none;
	}
	.still .node {
		opacity: 1;
	}
	.still .halo.open {
		opacity: 0.9;
	}
	@media (prefers-reduced-motion: reduce) {
		.grow {
			animation: none;
			stroke-dashoffset: 0;
		}
		.node {
			animation: none;
			opacity: 1;
		}
		.flare,
		.answered,
		.pulse {
			display: none;
		}
		.halo.open {
			animation: none;
			opacity: 0.9;
		}
	}
</style>
