<script lang="ts">
	import type { Person } from '@kizuna/shared';
	import { updatePerson } from '#lib/core/index.js';
	import { circlePeople, suggestedPeople } from '#lib/db.js';
	import { watch } from '#lib/ui/live.svelte.js';
	import { fold, soft } from '#lib/ui/motion.js';
	import Icon from '#lib/ui/Icon.svelte';

	const circle = watch<Person[]>(() => circlePeople(), []);
	const suggested = watch<Person[]>(() => suggestedPeople(), []);
	let note = $state('');

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

<div class="page">
	<div>
		<h1>Your circle</h1>
		<p class="muted">The people you want to keep close.</p>
	</div>

	{#if suggested.value.length}
		<section class="stack" aria-labelledby="noticed">
			<h3 id="noticed">Kizuna noticed these people come up a lot</h3>
			{#each suggested.value as p (p.id)}
				<article class="card suggest" out:fold in:soft>
					<h2>{p.name}</h2>
					{#if p.why}<p class="reason">{p.why}</p>{/if}
					<div class="actions">
						<button class="btn soft" type="button" onclick={() => decide(p, true)}>Keep close</button>
						<button class="btn quiet" type="button" onclick={() => decide(p, false)}>Not now</button>
					</div>
				</article>
			{/each}
			{#if note}<p class="note" role="alert">{note}</p>{/if}
		</section>
	{/if}

	<section class="stack" aria-label="People in your circle">
		{#if suggested.value.length && circle.value.length}<h3>In your circle</h3>{/if}
		{#each circle.value as p (p.id)}
			<a class="card person" href="/circle/{p.id}" in:soft>
				<span class="initial" aria-hidden="true">{p.name.slice(0, 1).toUpperCase()}</span>
				<span class="who">
					<span class="name">{p.name}</span>
					<span class="sum">{p.summary || RELATION[p.relation] || 'In your circle'}</span>
				</span>
				<Icon name="chevron" size={20} />
			</a>
		{/each}
		{#if circle.ready && suggested.ready && !circle.value.length && !suggested.value.length}
			<div class="empty">
				<p class="calm">Your circle builds itself.</p>
				<p class="muted">Talk about your day and Kizuna will notice who matters. You decide who stays.</p>
				<a href="/talk" class="btn primary big"><Icon name="mic" size={22} /> Talk to Kizuna</a>
			</div>
		{:else if circle.ready && !circle.value.length}
			<p class="note">Keep someone above and they’ll show up here.</p>
		{/if}
	</section>
</div>

<style>
	.suggest {
		background: var(--surface-2);
		box-shadow: none;
		border-color: transparent;
	}
	.person {
		flex-direction: row;
		align-items: center;
		gap: 14px;
		padding: 14px 14px 14px 16px;
	}
	.initial {
		flex: none;
		width: 44px;
		height: 44px;
		border-radius: 50%;
		display: grid;
		place-items: center;
		background: var(--surface-2);
		color: var(--text-2);
		font-weight: 650;
		font-size: 1.125rem;
	}
	.who {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
	}
	.name {
		font-weight: 620;
		font-size: 1.0625rem;
	}
	.sum {
		color: var(--text-2);
		font-size: 0.9375rem;
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}
	.person :global(svg) {
		color: var(--text-3);
	}
	.empty {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 8px;
		padding-top: 8px;
	}
	.empty .btn {
		margin-top: 10px;
	}
	.calm {
		font-size: 1.375rem;
		font-weight: 620;
	}
</style>
