<script lang="ts">
	// One tap after a line is sent: was it useful? Kept on this phone; the tester can share a summary in Settings.
	import { recordUseful, type UsefulAnswer, type UsefulEntry } from '#lib/core/index.js';
	import { soft } from './motion.js';
	let { what = 'line' }: { what?: UsefulEntry['what'] } = $props();
	let answered = $state<UsefulAnswer | null>(null);
	function pick(a: UsefulAnswer) {
		answered = a;
		recordUseful(a, what);
	}
</script>

<div class="useful" in:soft role="group" aria-label="Was this useful?">
	{#if answered}
		<p class="tiny" role="status">{answered === 'yes' ? 'Glad it helped.' : 'Thanks, noted.'}</p>
	{:else}
		<span class="tiny q">Was this useful?</span>
		<button class="btn small" type="button" onclick={() => pick('yes')}>Yes</button>
		<button class="btn small quiet" type="button" onclick={() => pick('not_really')}>Not really</button>
	{/if}
</div>

<style>
	.useful {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 4px 14px;
		min-height: 44px;
	}
	.q {
		color: var(--text-2);
	}
	.small {
		min-height: 36px;
		font-size: var(--t-small);
	}
	p {
		color: var(--text-2);
	}
</style>
