<script lang="ts">
	// A live preview of the Kizuna map for the landing page: a sample family as a constellation,
	// each with their real local time right now and a glow when they're open to a call.
	import { onMount } from 'svelte';
	import { daylightIn, timeIn } from './clock.js';

	type Spot = {
		name: string;
		city: string;
		tz: string;
		hue: string;
		x: number;
		y: number;
		open?: boolean;
		label: 'above' | 'below';
		mark?: 'diya' | 'cake';
	};

	const CX = 280;
	const CY = 226;
	const people: Spot[] = [
		{ name: 'Nani', city: 'Delhi', tz: 'Asia/Kolkata', hue: '#f4c46c', x: 205, y: 140, label: 'above', open: true },
		{ name: 'Papa', city: 'Delhi', tz: 'Asia/Kolkata', hue: '#d6e38a', x: 355, y: 140, label: 'above', mark: 'cake' },
		{ name: 'Riya', city: 'Bengaluru', tz: 'Asia/Kolkata', hue: '#b6a4f4', x: 205, y: 312, label: 'below' },
		{ name: 'Mum', city: 'Delhi', tz: 'Asia/Kolkata', hue: '#9cc6ee', x: 355, y: 312, label: 'below', open: true },
		{ name: 'Kabir', city: 'Toronto', tz: 'America/Toronto', hue: '#f39b80', x: 508, y: 226, label: 'below', open: true },
		{ name: 'Meera', city: 'London', tz: 'Europe/London', hue: '#e3cba2', x: 52, y: 226, label: 'below', mark: 'diya' }
	];
	const R = 13;

	let now = $state(new Date());
	onMount(() => {
		const t = setInterval(() => (now = new Date()), 20_000);
		return () => clearInterval(t);
	});
	const myTz = typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : 'Asia/Kolkata';

	const TOP = 'M43.36 31.04 A20 20 0 0 1 54.75 40.78';
	const BOTTOM = 'M56.64 68.96 A20 20 0 0 1 45.25 59.22';
</script>

<figure class="hm" aria-label="A sample Kizuna map: you in the middle, family close, friends further out, each with their local time.">
	<svg viewBox="0 24 560 386" width="100%" aria-hidden="true">
		<defs>
			{#each people as p, i (p.name)}
				<radialGradient id="hm-g{i}">
					<stop offset="0%" stop-color={p.hue} stop-opacity="0.85" />
					<stop offset="55%" stop-color={p.hue} stop-opacity="0.3" />
					<stop offset="100%" stop-color={p.hue} stop-opacity="0" />
				</radialGradient>
				<clipPath id="hm-c{i}"><circle cx={p.x} cy={p.y} r={R} /></clipPath>
			{/each}
		</defs>

		<ellipse class="ring" cx={CX} cy={CY} rx="106" ry="118" />
		<g class="spin"><ellipse class="ring outer" cx={CX} cy={CY} rx="228" ry="160" /></g>

		{#each people as p, i (p.name)}
			{#if p.open}
				{@const len = Math.hypot(p.x - CX, p.y - CY)}
				{@const ux = (p.x - CX) / len}
				{@const uy = (p.y - CY) / len}
				<line class="tie" x1={CX + ux * 34} y1={CY + uy * 34} x2={p.x - ux * 18} y2={p.y - uy * 18} style="--i:{i}" pathLength="1" />
			{/if}
		{/each}

		<g class="me">
			<g transform="translate({CX - 15} {CY - 24}) scale(0.3)">
				<g transform="rotate(-28 50 50)" fill="none" stroke-width="8">
					<circle cx="37" cy="50" r="20" class="ink" />
					<circle cx="63" cy="50" r="20" class="acc" />
					<path d={TOP} class="paper" stroke-width="13" />
					<path d={TOP} class="ink" stroke-linecap="round" />
					<path d={BOTTOM} class="paper" stroke-width="13" />
					<path d={BOTTOM} class="acc" stroke-linecap="round" />
				</g>
			</g>
			<text x={CX} y={CY + 22} text-anchor="middle" class="you">You</text>
			<text x={CX} y={CY + 36} text-anchor="middle" class="sub">{timeIn(myTz, now) || '18:30'}</text>
		</g>

		{#each people as p, i (p.name)}
			{@const day = daylightIn(p.tz, now)}
			<g class="spot" style="--i:{i}">
				{#if p.open}
					<circle class="halo" cx={p.x} cy={p.y} r={R * 2.7} fill="url(#hm-g{i})" />
				{/if}
				<circle cx={p.x} cy={p.y} r={R} fill={p.hue} />
				{#if day < 0.98}
					<circle class="shade" cx={p.x + 2 * R * day} cy={p.y} r={R} clip-path="url(#hm-c{i})" />
					<circle class="night" cx={p.x} cy={p.y} r={R - 0.5} />
				{/if}
				{#if p.mark === 'cake'}
					<g transform="translate({p.x + 15} {p.y - 14})">
						<rect x="-4.5" y="-1" width="9" height="5" rx="1" class="ink-fill" />
						<line x1="0" y1="-1" x2="0" y2="-4" class="ink-line" />
						<circle cx="0" cy="-5.2" r="1.3" class="flame" />
					</g>
				{:else if p.mark === 'diya'}
					<g transform="translate({p.x + 15} {p.y - 13})">
						<path d="M-5 0 Q0 5 5 0 Z" class="ink-fill" />
						<path d="M0 -1 Q-2.2 -3.4 0 -6.6 Q2.2 -3.4 0 -1 Z" class="flame" />
					</g>
				{/if}
				{#if p.label === 'above'}
					<text x={p.x} y={p.y - 44} text-anchor="middle" class="name">{p.name}</text>
					<text x={p.x} y={p.y - 28} text-anchor="middle" class="sub">{timeIn(p.tz, now)} {p.city}</text>
				{:else}
					<text x={p.x} y={p.y + 36} text-anchor="middle" class="name">{p.name}</text>
					<text x={p.x} y={p.y + 52} text-anchor="middle" class="sub">{timeIn(p.tz, now)} {p.city}</text>
				{/if}
			</g>
		{/each}
	</svg>
	<figcaption class="legend">
		<span><i class="glow"></i>open to a call</span>
		<span><i class="moon"></i>night there</span>
		<span class="live"><i class="pulse"></i>times are live</span>
	</figcaption>
</figure>

<style>
	.hm {
		margin: 0;
		width: 100%;
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
		stroke-dasharray: 2 6;
	}
	.spin {
		transform-origin: 280px 226px;
		animation: spin 120s linear infinite;
	}
	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
	.tie {
		stroke: var(--accent);
		stroke-opacity: 0.35;
		stroke-width: 1;
		stroke-dasharray: 1;
		stroke-dashoffset: 1;
		animation: draw 1.4s var(--ease) forwards;
		animation-delay: calc(900ms + var(--i) * 140ms);
		vector-effect: non-scaling-stroke;
	}
	@keyframes draw {
		to {
			stroke-dashoffset: 0;
		}
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
	.you {
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
		font-size: 23px;
		fill: var(--text);
	}
	.sub {
		font-family: var(--sans);
		font-size: 13px;
		fill: var(--text-3);
		font-variant-numeric: tabular-nums;
	}
	.spot {
		opacity: 0;
		animation: pop 700ms var(--ease) forwards;
		animation-delay: calc(250ms + var(--i) * 110ms);
	}
	@keyframes pop {
		from {
			opacity: 0;
			transform: translateY(6px);
		}
		to {
			opacity: 1;
			transform: none;
		}
	}
	.halo {
		transform-box: fill-box;
		transform-origin: center;
		animation: breathe 4.2s ease-in-out infinite;
		animation-delay: calc(var(--i) * -0.9s);
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
	.shade {
		fill: var(--bg);
		fill-opacity: 0.62;
	}
	.night {
		fill: none;
		stroke: var(--text-3);
		stroke-width: 0.75;
		stroke-opacity: 0.6;
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
	.legend {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: 6px 20px;
		margin-top: 18px;
		font-size: 0.8125rem;
		color: var(--text-3);
	}
	.legend span {
		display: inline-flex;
		align-items: center;
		gap: 8px;
	}
	.legend i {
		display: inline-block;
		width: 10px;
		height: 10px;
		border-radius: 50%;
	}
	.glow {
		background: #f4c46c;
		box-shadow: 0 0 0 4px rgb(244 196 108 / 0.3);
	}
	.moon {
		background: linear-gradient(90deg, #9cc6ee 50%, color-mix(in srgb, #9cc6ee 38%, var(--bg)) 50%);
		box-shadow: inset 0 0 0 0.75px var(--text-3);
	}
	.pulse {
		width: 7px !important;
		height: 7px !important;
		background: var(--accent);
		animation: blink 2.4s ease-in-out infinite;
	}
	@keyframes blink {
		50% {
			opacity: 0.25;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.spot,
		.tie {
			animation: none;
			opacity: 1;
			stroke-dashoffset: 0;
		}
		.halo,
		.spin,
		.pulse {
			animation: none;
		}
	}
</style>
