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
	// outside. No location: only names, local time, daylight and whether someone is open to a call.
	import { hueFor } from './hue.js';
	import { cityOf, DOT_R, dotLabel, layoutConstellation, shortName } from './constellation.js';

	let {
		people,
		me
	}: {
		people: DotPerson[];
		me: { name: string; localTime: string };
	} = $props();

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
	const uid = $props.id();

	function sub(p: DotPerson): string {
		if (!p.localTime) return '';
		const city = cityOf(p.tz);
		return city ? `${p.localTime} ${city}` : p.localTime;
	}
	const gid = (id: string) => `g-${uid}-${id.replace(/[^A-Za-z0-9_-]/g, '')}`;

	const TOP = 'M43.36 31.04 A20 20 0 0 1 54.75 40.78';
	const BOTTOM = 'M56.64 68.96 A20 20 0 0 1 45.25 59.22';
</script>

<figure class="map" aria-label="Your Kizuna map">
	<svg viewBox="0 {layout.top} {layout.width} {layout.bottom - layout.top}" width="100%" role="group" aria-label="People on your map">
		<defs>
			{#each layout.dots as d (d.id)}
				<clipPath id="c-{gid(d.id)}"><circle cx={d.x} cy={d.y} r={DOT_R} /></clipPath>
			{/each}
			{#each shown as p (p.person.id)}
				<radialGradient id={gid(p.person.id)}>
					<stop offset="0%" stop-color={hueFor(p.person.id)} stop-opacity="0.75" />
					<stop offset="55%" stop-color={hueFor(p.person.id)} stop-opacity="0.28" />
					<stop offset="100%" stop-color={hueFor(p.person.id)} stop-opacity="0" />
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

		<!-- you -->
		<g class="me" aria-label="You, {me.localTime}" role="img">
			<g transform="translate({layout.cx - 14} {layout.cy - 20}) scale(0.28)">
				<g transform="rotate(-28 50 50)" fill="none" stroke-width="8">
					<circle cx="37" cy="50" r="20" class="ink" />
					<circle cx="63" cy="50" r="20" class="acc" />
					<path d={TOP} class="paper" stroke-width="13" />
					<path d={TOP} class="ink" stroke-linecap="round" />
					<path d={BOTTOM} class="paper" stroke-width="13" />
					<path d={BOTTOM} class="acc" stroke-linecap="round" />
				</g>
			</g>
			<text x={layout.cx} y={layout.cy + 22} text-anchor="middle" class="me-name">{me.name || 'You'}</text>
			<text x={layout.cx} y={layout.cy + 34} text-anchor="middle" class="sub num">{me.localTime}</text>
		</g>

		{#each layout.dots as d (d.id)}
			{@const p = byId.get(d.id)!}
			{@const hue = hueFor(d.id)}
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
				{#if p.glow === 'open'}
					<circle class="halo open" cx={d.x} cy={d.y} r={DOT_R * 2.5} fill="url(#{gid(d.id)})" />
				{:else if p.glow === 'maybe'}
					<circle class="halo maybe" cx={d.x} cy={d.y} r={DOT_R * 2} fill="url(#{gid(d.id)})" />
				{/if}
				<circle class="focus" cx={d.x} cy={d.y} r={DOT_R + 5} />
				<circle class="dot" cx={d.x} cy={d.y} r={DOT_R} fill={hue} />
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
							<!-- diya -->
							<path d="M-5 0 Q0 5 5 0 Z" class="ink-fill" />
							<path d="M0 -1 Q-2.2 -3.4 0 -6.6 Q2.2 -3.4 0 -1 Z" class="flame" />
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
			</a>
		{/each}
	</svg>
</figure>

<style>
	.map {
		margin: 0 auto;
		width: 100%;
		max-width: var(--map-w, 430px);
	}
	svg {
		display: block;
		overflow: visible;
	}
	.ring {
		fill: none;
		stroke: var(--line);
		stroke-width: 1;
		vector-effect: non-scaling-stroke;
	}
	.ring.outer {
		stroke-dasharray: 2 5;
	}
	.ink {
		stroke: var(--text);
	}
	.acc {
		stroke: var(--seal);
	}
	.paper {
		stroke: var(--bg);
	}
	.me-name {
		font-family: var(--sans);
		font-size: 10px;
		font-weight: 500;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		fill: var(--text-3);
	}
	.name {
		font-family: var(--serif);
		font-style: italic;
		font-size: 18px;
		fill: var(--text);
	}
	.sub {
		font-family: var(--sans);
		font-size: 11px;
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
	.shade {
		fill: var(--bg);
		fill-opacity: 0.62;
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
	.halo {
		transform-box: fill-box;
		transform-origin: center;
		pointer-events: none;
	}
	.halo.open {
		animation: breathe 4.2s ease-in-out infinite;
	}
	.halo.maybe {
		opacity: 0.55;
	}
	@keyframes breathe {
		0%,
		100% {
			opacity: 0.75;
			transform: scale(0.88);
		}
		50% {
			opacity: 1;
			transform: scale(1.08);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.halo.open {
			animation: none;
			opacity: 0.9;
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
		fill: var(--seal);
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
</style>
