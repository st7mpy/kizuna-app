<script lang="ts">
	import type { Thread } from '@kizuna/shared';
	import { updateThread } from '#lib/core/index.js';
	import { openThreads } from '#lib/db.js';
	import { watch } from '#lib/ui/live.svelte.js';
	import { cap, dayLabel, groupThreads } from '#lib/ui/format.js';
	import { fold } from '#lib/ui/motion.js';
	import Icon from '#lib/ui/Icon.svelte';

	const threads = watch<Thread[]>(() => openThreads(), []);
	const groups = $derived(groupThreads(threads.value));
	let note = $state('');

	async function done(t: Thread) {
		note = '';
		try {
			await updateThread(t.id, { status: 'done' });
		} catch {
			note = 'Couldn’t mark that just now. Try again in a moment.';
		}
	}
</script>

<svelte:head><title>Threads · Kizuna</title></svelte:head>

<div class="page">
	<a href="/" class="back"><Icon name="back" size={20} /> Today</a>
	<div>
		<h1>Your threads</h1>
		<p class="muted">Things you said you’d like to do. No rush.</p>
	</div>

	{#each groups as g (g.kind)}
		<section class="stack" aria-labelledby="g-{g.kind}">
			<h3 id="g-{g.kind}">{g.label}</h3>
			<ul class="list">
				{#each g.items as t (t.id)}
					<li out:fold>
						<span class="title">
							{cap(t.title)}
							{#if t.dueDay}<span class="when">{dayLabel(t.dueDay)}</span>{/if}
						</span>
						<button class="btn done" type="button" onclick={() => done(t)} aria-label="Done: {t.title}">
							<Icon name="check" size={20} /> Done
						</button>
					</li>
				{/each}
			</ul>
		</section>
	{/each}

	{#if note}<p class="note" role="alert">{note}</p>{/if}

	{#if threads.ready && !groups.length}
		<div class="stack">
			<p class="calm">All clear.</p>
			<p class="muted">When you mention an idea, a plan or an errand, it lands here.</p>
		</div>
	{/if}
</div>

<style>
	.back {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		min-height: var(--tap);
		margin: -8px 0 -12px -6px;
		color: var(--text-2);
		text-decoration: none;
		font-weight: 560;
		align-self: flex-start;
	}
	.list {
		list-style: none;
		margin: 0;
		padding: 0;
		background: var(--surface);
		border: 1px solid var(--line);
		border-radius: var(--radius);
	}
	.list li {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		padding: 10px 10px 10px 16px;
	}
	.list li + li {
		border-top: 1px solid var(--line);
	}
	.title {
		display: flex;
		flex-direction: column;
		font-weight: 520;
	}
	.when {
		font-size: 0.8125rem;
		font-weight: 600;
		color: var(--text-3);
	}
	.done {
		flex: none;
		padding: 0 14px;
		color: var(--text-2);
	}
	.calm {
		font-size: 1.375rem;
		font-weight: 620;
	}
</style>
