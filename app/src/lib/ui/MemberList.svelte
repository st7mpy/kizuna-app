<script lang="ts">
	// The people on the map as a list: a round initial in their colour, the name, one status line.
	// A rounded card under the map on a phone, beside it on a wide screen.
	import { dotHref, type DotPerson } from './Constellation.svelte';
	import { cityOf } from './constellation.js';
	import { hueOf } from './hue.js';
	import { initials, memberStatus } from './mapformat.js';
	import Icon from './Icon.svelte';

	let {
		people,
		title = 'On your map',
		compact = false
	}: { people: DotPerson[]; title?: string; compact?: boolean } = $props();
</script>

<section class="members" class:compact aria-label={title}>
	<h2 class="label">{title}</h2>
	<ul>
		{#each people as p (p.person.id)}
			{@const s = p.unlinked ? { text: 'New answer', tone: 'plain' } : memberStatus(p, cityOf)}
			<li>
				<a class="member" href={dotHref(p)}>
					<span class="avatar" class:open={p.glow === 'open'} class:new={p.unlinked} style="--hue:{hueOf(p)}" aria-hidden="true">
						{initials(p.person.name)}
					</span>
					<span class="col">
						<span class="top">
							<span class="name">{p.person.name}</span>
							{#if p.occasion}<span class="occ">{p.occasion.name}</span>{/if}
						</span>
						<span class="status {s.tone}">
							{#if s.tone === 'open' || s.tone === 'maybe'}<i class="glow" aria-hidden="true"></i>{/if}
							{#if s.tone === 'night'}<i class="moon" aria-hidden="true"></i>{/if}
							<span class="num">{s.text}</span>
						</span>
					</span>
					{#if p.unlinked}<span class="who">Who is this?</span>{/if}
					<Icon name="chevron" size={18} />
				</a>
			</li>
		{/each}
	</ul>
</section>

<style>
	.members {
		position: relative;
		display: flex;
		flex-direction: column;
		background: var(--surface);
		border-radius: var(--r-card);
		box-shadow: var(--card-shadow);
		padding: 14px 18px 6px;
	}
	.who {
		flex: none;
		color: var(--accent);
		font-size: var(--t-small);
		font-weight: 500;
	}
	.avatar.new {
		box-shadow: inset 0 0 0 1.5px rgb(20 19 17 / 0.35);
		background: color-mix(in srgb, var(--hue) 55%, var(--surface-solid));
	}
	h2 {
		padding: 4px 0 6px;
	}
	ul {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	li + li {
		border-top: 1px solid var(--line);
	}
	.member {
		display: flex;
		align-items: center;
		gap: 14px;
		min-height: 68px;
		padding: 10px 0;
		color: var(--text);
		text-decoration: none;
	}
	.member :global(svg) {
		flex: none;
		color: var(--text-3);
	}
	.avatar {
		flex: none;
		position: relative;
		display: grid;
		place-items: center;
		width: 44px;
		height: 44px;
		border-radius: 50%;
		background: var(--hue);
		color: #141311;
		font-size: 0.875rem;
		font-weight: 600;
		letter-spacing: 0.02em;
	}
	/* Open to a call: a slow breathing glow, not a badge. */
	.avatar.open::before {
		content: '';
		position: absolute;
		inset: -10px;
		z-index: -1;
		border-radius: 50%;
		background: radial-gradient(closest-side, var(--glow), transparent);
		animation: breathe 4.8s steps(6) infinite; /* stepped: see app.css */
	}
	.avatar.open {
		isolation: isolate;
		z-index: 0;
	}
	.col {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
	}
	.top {
		display: flex;
		align-items: center;
		gap: 10px;
		min-width: 0;
	}
	.name {
		min-width: 0;
		font-size: 1.0625rem;
		font-weight: 500;
		letter-spacing: -0.015em;
		line-height: 1.3;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.status {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: var(--t-small);
		color: var(--text-2);
		white-space: nowrap;
		overflow: hidden;
	}
	.status > span {
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.status.open {
		color: var(--text);
	}
	.status.none {
		color: var(--text-3);
	}
	.glow {
		flex: none;
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: #e9b36f;
		box-shadow: 0 0 0 3px var(--glow);
		animation: breathe 4.8s steps(6) infinite; /* stepped: see app.css */
	}
	.maybe .glow {
		opacity: 0.6;
	}
	.moon {
		flex: none;
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: linear-gradient(90deg, var(--text-3) 50%, transparent 50%);
		box-shadow: inset 0 0 0 1px var(--text-3);
	}
	.occ {
		flex: none;
		max-width: 11em;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: 0.75rem;
		font-weight: 500;
		color: var(--text-2);
		padding: 2px 9px;
		border-radius: 999px;
		background: var(--bg-2);
	}
	.member:focus-visible {
		outline-offset: -2px;
	}

	/* Beside the map: a rounded panel, not a sheet. */
	@media (min-width: 720px) {
		.members {
			padding: 18px 20px 8px;
		}
	}
	.compact .name {
		font-size: 1rem;
	}
	.compact .member {
		min-height: 56px;
	}
	.compact .avatar {
		width: 36px;
		height: 36px;
		font-size: 0.75rem;
	}
</style>
