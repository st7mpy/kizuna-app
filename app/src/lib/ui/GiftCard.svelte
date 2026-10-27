<script lang="ts">
	// "Dad's birthday is in 9 days. You noted Dad wanted new running shoes. Plan with Maya?"
	// Never prices, money or shopping links.
	import type { GiftCard, Person } from '@kizuna/shared';
	import { draftGiftLine, markGift } from '#lib/core/index.js';
	import { giftLead } from './mapformat.js';
	import DraftBox from './DraftBox.svelte';

	let {
		card,
		people,
		ondismiss
	}: {
		card: GiftCard;
		people: Map<string, Person>;
		ondismiss?: () => void;
	} = $props();

	const who = $derived(people.get(card.personId));
	const sib = $derived(card.withPersonId ? people.get(card.withPersonId) : undefined);
	let drafting = $state(false);

	async function mark(status: 'done' | 'dropped') {
		try {
			await markGift(card.hint.id, status);
		} catch {
			/* it shows again another day */
		}
		ondismiss?.();
	}
</script>

<article class="gift">
	<p class="label">A small gift</p>
	<p class="lead">
		{giftLead(card.occasion.name, card.daysLeft)}
		You noted
		<em>{who?.name ?? 'they'}</em>
		wanted {card.hint.what}.
		{#if sib}Plan with <em>{sib.name}</em>?{/if}
	</p>

	{#if drafting && sib}
		<DraftBox
			label="For {sib.name}"
			phone={sib.phone}
			load={() => draftGiftLine(card)}
			oncancel={() => (drafting = false)}
		/>
	{/if}

	<div class="acts">
		{#if sib && !drafting}
			<button class="btn accent" type="button" onclick={() => (drafting = true)}>
				Plan with <em class="inline">{sib.name}</em>
			</button>
		{/if}
		<button class="btn" type="button" onclick={() => mark('done')}>Done</button>
		<button class="btn quiet" type="button" onclick={() => mark('dropped')}>Not this time</button>
	</div>
</article>

<style>
	.gift {
		display: flex;
		flex-direction: column;
		gap: 6px;
		padding: 18px 20px 8px;
		background: var(--surface);
		-webkit-backdrop-filter: var(--blur);
		backdrop-filter: var(--blur);
		border-radius: var(--r-card);
		box-shadow: var(--card-shadow);
	}
	.lead {
		font-size: var(--t-lead);
		line-height: 1.45;
	}
	.acts {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		column-gap: 22px;
	}
	.acts .quiet {
		margin-left: auto;
	}
	.inline {
		font-weight: 600;
	}
</style>
