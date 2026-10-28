<script lang="ts">
	import type { Thread } from '@kizuna/shared';
	import { updateThread } from '#lib/core/index.js';
	import { openThreads } from '#lib/db.js';
	import { watch } from '#lib/ui/live.svelte.js';
	import { cap, dayLabel, groupThreads } from '#lib/ui/format.js';
	import { fold } from '#lib/ui/motion.js';
	import Icon from '#lib/ui/Icon.svelte';
	import { say } from '#lib/ui/toast.svelte.js';

	const threads = watch<Thread[]>(() => openThreads(), []);
	const groups = $derived(groupThreads(threads.value));
	let note = $state('');

	async function done(t: Thread) {
		note = '';
		try {
			await updateThread(t.id, { status: 'done' });
			// One mis-tap shouldn't lose a thread: a moment to take it back.
			say('Marked done', 6000, {
				label: 'Undo',
				run: async () => {
					try {
						await updateThread(t.id, { status: 'open' });
					} catch {
						note = 'Couldn’t bring that back just now. Try again in a moment.';
					}
				}
			});
		} catch {
			note = 'Couldn’t mark that just now. Try again in a moment.';
		}
	}
</script>

<svelte:head><title>Threads · Kizuna</title></svelte:head>

<div class="page">
	<a href="/" class="back"><Icon name="back" size={18} /> Today</a>
	<div class="head">
		<h1>Your threads</h1>
		<p class="lede">Things you said you’d like to do. <em>No rush.</em></p>
	</div>

	{#each groups as g (g.kind)}
		<section class="section" aria-labelledby="g-{g.kind}">
			<h3 id="g-{g.kind}">{g.label}</h3>
			<ul class="rows">
				{#each g.items as t (t.id)}
					<li out:fold>
						<span class="title">
							{cap(t.title)}
							{#if t.dueDay}<span class="when">{dayLabel(t.dueDay)}</span>{/if}
						</span>
						<button class="icon-btn" type="button" onclick={() => done(t)} aria-label="Done: {t.title}">
							<Icon name="check" size={20} />
						</button>
					</li>
				{/each}
			</ul>
		</section>
	{/each}

	{#if note}<p class="note" role="alert">{note}</p>{/if}

	{#if threads.ready && !groups.length}
		<div class="stack">
			<p class="calm">All <em>clear</em>.</p>
			<p class="muted">When you mention an idea, a plan or an errand, it lands here.</p>
		</div>
	{/if}
</div>

<style>
	li {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 16px;
		padding: 12px 0;
	}
	.title {
		display: flex;
		flex-direction: column;
		font-size: var(--t-lead);
		letter-spacing: -0.01em;
		line-height: 1.35;
	}
	.when {
		font-size: var(--t-label);
		font-weight: 500;
		letter-spacing: 0;
		color: var(--text-3);
		margin-top: 2px;
	}
	.icon-btn:hover {
		background: var(--rule);
		color: var(--on-rule);
	}
</style>
