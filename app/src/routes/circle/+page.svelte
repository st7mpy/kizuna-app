<script lang="ts">
	import type { Person } from '@kizuna/shared';
	import { onDestroy } from 'svelte';
	import { onWeaveBuilding, updatePerson } from '#lib/core/index.js';
	import { circlePeople, mapLive, suggestedPeople, type MapView } from '#lib/db.js';
	import { watch } from '#lib/ui/live.svelte.js';
	import { fold, soft } from '#lib/ui/motion.js';
	import Icon from '#lib/ui/Icon.svelte';
	import { hueFor as hashHue } from '#lib/ui/hue.js';

	const circle = watch<Person[]>(() => circlePeople(), []);
	const suggested = watch<Person[]>(() => suggestedPeople(), []);
	// The map gives each person their own colour; reading it here keeps the list in the same colours.
	const map = watch<MapView | undefined>(() => mapLive(), undefined);
	const hueFor = (id: string) => (void map.value, hashHue(id));
	let note = $state('');
	let building = $state(false);
	onDestroy(onWeaveBuilding((b) => (building = b)));

	async function decide(p: Person, keep: boolean) {
		note = '';
		try {
			await updatePerson(p.id, { circle: keep ? 'in' : 'out' });
		} catch {
			note = 'Couldn’t save that just now. Try again in a moment.';
		}
	}

	const RELATION: Record<string, string> = {
		parent: 'Family',
		sibling: 'Family',
		partner: 'Partner',
		child: 'Family',
		family: 'Family',
		friend: 'Friend',
		colleague: 'Work'
	};
</script>

<svelte:head><title>Circle · Kizuna</title></svelte:head>

<div class="page wide">
	<div class="head">
		<h1>Your circle</h1>
		<p class="lede">The people you want to keep <em>close</em>.</p>
	</div>

	{#if suggested.value.length}
		<section class="section" aria-labelledby="noticed">
			<h3 id="noticed">Kizuna noticed these people come up a lot</h3>
			<div class="rows">
				{#each suggested.value as p (p.id)}
					<article class="suggest" out:fold in:soft>
						<h2 class="who">
							<span class="dot" style="--hue:{hueFor(p.id)}" aria-hidden="true"></span><em>{p.name}</em>
						</h2>
						{#if p.why}<p class="muted">{p.why}</p>{/if}
						<div class="row actions">
							<button class="btn accent" type="button" onclick={() => decide(p, true)}>Keep close</button>
							<button class="btn quiet" type="button" onclick={() => decide(p, false)}>Not now</button>
						</div>
					</article>
				{/each}
			</div>
			{#if note}<p class="note" role="alert">{note}</p>{/if}
		</section>
	{/if}

	<section class="section" aria-label="People in your circle">
		{#if suggested.value.length && circle.value.length}<h3>In your circle</h3>{/if}
		<div class="rows people" class:open-top={!suggested.value.length}>
			{#each circle.value as p (p.id)}
				<a class="person" href="/circle/{p.id}" in:soft>
					<span class="window swatch" style="--hue:{hueFor(p.id)}" aria-hidden="true"></span>
					<span class="who-col">
						<span class="name">{p.name}</span>
						<span class="sum">{p.summary || RELATION[p.relation] || 'In your circle'}</span>
					</span>
					<Icon name="chevron" size={18} />
				</a>
			{/each}
		</div>
		{#if circle.ready && suggested.ready && !circle.value.length && !suggested.value.length && building}
			<div class="empty" role="status">
				<p class="calm">Building your circle…</p>
				<p class="muted">Kizuna is reading your notes to see who matters. This takes about half a minute.</p>
			</div>
		{:else if circle.ready && suggested.ready && !circle.value.length && !suggested.value.length}
			<div class="empty">
				<p class="calm">Your circle <em>builds itself</em>.</p>
				<p class="muted">Talk about your day and Kizuna will notice who matters. You decide who stays.</p>
				<a href="/talk" class="btn primary big"><Icon name="mic" size={22} /> Talk to Kizuna</a>
			</div>
		{:else if circle.ready && !circle.value.length}
			<p class="note pad">Keep someone above and they’ll show up here.</p>
		{/if}
	</section>
</div>

<style>
	.suggest {
		display: flex;
		flex-direction: column;
		gap: 4px;
		padding: 18px 0 8px;
	}
	.who {
		display: flex;
		align-items: center;
		gap: 12px;
		font-size: 1.5rem;
		line-height: 1.15;
		letter-spacing: -0.03em;
	}
	.who .dot {
		width: 12px;
		height: 12px;
		margin-top: 4px;
	}
	.actions {
		gap: 22px;
	}
	.person {
		display: flex;
		align-items: center;
		gap: 16px;
		padding: 14px 0;
		color: var(--text);
		text-decoration: none;
	}
	.swatch {
		flex: none;
		width: 52px;
		height: 52px;
		border-radius: 50%;
	}
	.who-col {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
	}
	.name {
		font-size: 1.25rem;
		font-weight: 500;
		letter-spacing: -0.025em;
		line-height: 1.2;
	}
	.sum {
		color: var(--text-2);
		font-size: var(--t-small);
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}
	.person :global(svg) {
		color: var(--text-3);
	}
	.person:focus-visible {
		outline-offset: -2px;
	}
	.empty {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 8px;
		padding-top: 8px;
	}
	.empty .btn {
		margin-top: 14px;
	}
	.pad {
		padding-top: 14px;
	}
	/* Wider screens: the circle as a grid of soft tiles, still one tap to a person. */
	@media (min-width: 720px) {
		.head .lede {
			max-width: none;
		}
		.suggest .muted {
			max-width: 60ch;
		}
		.people {
			display: grid;
			grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
			gap: 16px;
			padding-top: 16px;
		}
		.people.open-top > :first-child,
		.people > * {
			border: 0;
		}
		.person {
			flex-direction: column;
			align-items: stretch;
			gap: 14px;
			padding: 14px 14px 18px;
			border-radius: var(--r-card);
			background: var(--surface);
			box-shadow: var(--card-shadow);
			transition:
				transform 500ms var(--ease-out),
				box-shadow 500ms var(--ease-out);
		}
		.person:hover {
			transform: translateY(-4px);
			box-shadow: var(--card-shadow), var(--shadow);
		}
		.person:active {
			transform: scale(0.99);
		}
		.swatch {
			width: 100%;
			height: 104px;
			border-radius: 16px;
		}
		.who-col {
			padding: 0 6px;
			gap: 4px;
		}
		.person > :global(svg) {
			display: none;
		}
	}
</style>
