<script lang="ts">
	// One weekend plan, or nothing. Shown on Today and on the map.
	import type { Person, WeekendCard } from '@kizuna/shared';
	import {
		answerWeekend,
		draftForGroup,
		draftForPerson,
		googleCalendarLink,
		icsFile,
		planWeekend,
		WHATSAPP_SCHEDULE_TIP
	} from '#lib/core/index.js';
	import { hueFor } from './hue.js';
	import { skippedLine, traceLine, whenLocal } from './mapformat.js';
	import DraftBox from './DraftBox.svelte';
	import Icon from './Icon.svelte';

	let {
		card,
		people,
		ondismiss
	}: {
		card: WeekendCard;
		people: Map<string, Person>;
		/** Called after "Not now"; the parent hides the card. */
		ondismiss?: () => void;
	} = $props();

	const uid = $props.id();
	// "Change it" can replace the plan in place.
	let override = $state<WeekendCard | null>(null);
	const c = $derived(override ?? card);

	const nameOf = (id: string) => people.get(id)?.name ?? 'Someone';
	const when = $derived(whenLocal(c.slot.start));
	const free = $derived(c.personIds.filter((id) => id !== 'me'));
	const trace = $derived(traceLine(c.trace));
	const title = $derived(c.occasion ? `${c.occasion} call` : 'Family call');

	// one open draft at a time: 'group' or a person id
	let drafting = $state<string | null>(null);
	let calOpen = $state(false);

	function opened(kind: string) {
		if (kind === 'group') answerWeekend('done').catch(() => {});
	}

	function google() {
		window.open(googleCalendarLink(c.slot, title), '_blank', 'noopener');
	}
	function ics() {
		const url = URL.createObjectURL(icsFile(c.slot, title));
		const a = document.createElement('a');
		a.href = url;
		a.download = 'kizuna-call.ics';
		a.click();
		setTimeout(() => URL.revokeObjectURL(url), 2000);
	}

	async function notNow() {
		try {
			await answerWeekend('not_now');
		} catch {
			/* it simply shows again later */
		}
		ondismiss?.();
	}

	// change it
	let changing = $state(false);
	let request = $state('');
	let replanning = $state(false);
	let changeNote = $state('');
	async function replan(e: SubmitEvent) {
		e.preventDefault();
		const r = request.trim();
		if (!r) return;
		replanning = true;
		changeNote = '';
		try {
			const next = await planWeekend(r);
			if (next) {
				override = next;
				drafting = null;
				changing = false;
				request = '';
			} else {
				changeNote = 'Nothing fits that this weekend. That’s fine too.';
			}
		} catch {
			changeNote = 'Couldn’t plan again just now. Try in a moment.';
		} finally {
			replanning = false;
		}
	}
</script>

<article class="weekend" aria-labelledby="wk-{uid}">
	<p class="label">This weekend</p>
	<h2 id="wk-{uid}" class="when">
		<span class="num">{when}</span> <span class="yours">your time</span>
	</h2>
	{#if free.length}
		<p class="who">
			{#each free as id, i (id)}<span class="nm"
					><span class="dot" style="--hue:{hueFor(id)}" aria-hidden="true"></span><em>{nameOf(id)}</em></span
				>{i < free.length - 2 ? ', ' : i === free.length - 2 ? ' and ' : ''}{/each}
			{free.length === 1 ? 'is' : 'are'} free.
		</p>
	{/if}
	{#if c.reason}<p class="reason">{c.reason}</p>{/if}

	{#if c.skipped.length}
		<ul class="skipped">
			{#each c.skipped as s (s.personId)}
				<li>
					{skippedLine(nameOf(s.personId), s.why)}
					{#if s.alt}<span class="alt">{whenLocal(s.alt.start)} instead?</span>{/if}
				</li>
			{/each}
		</ul>
	{/if}

	{#if trace}<p class="trace" aria-label="How Kizuna found this: {trace}">{trace}</p>{/if}

	{#if drafting === 'group'}
		<DraftBox
			label="For the family group"
			load={() => draftForGroup(c)}
			tip={WHATSAPP_SCHEDULE_TIP}
			onopened={() => opened('group')}
			oncancel={() => (drafting = null)}
		/>
	{:else if drafting}
		{@const id = drafting}
		<DraftBox
			label="For {nameOf(id)}"
			phone={people.get(id)?.phone}
			load={() => draftForPerson(c, id)}
			tip={WHATSAPP_SCHEDULE_TIP}
			oncancel={() => (drafting = null)}
		/>
	{/if}

	{#if drafting !== 'group'}
		<button class="btn primary big main" type="button" onclick={() => (drafting = 'group')}>
			Draft for the family group
		</button>
	{/if}
	<div class="acts">
		{#each c.skipped as s (s.personId)}
			{#if drafting !== s.personId}
				<button class="btn" type="button" onclick={() => (drafting = s.personId)}>
					Draft for <em class="inline">{nameOf(s.personId)}</em>
				</button>
			{/if}
		{/each}
		<button class="btn" type="button" aria-expanded={calOpen} onclick={() => (calOpen = !calOpen)}>
			<Icon name="calendar" size={18} /> Add to calendar
		</button>
		{#if calOpen}
			<span class="cal">
				<button class="btn small-btn" type="button" onclick={google}>Google Calendar</button>
				<button class="btn small-btn" type="button" onclick={ics}>Other calendar (.ics)</button>
			</span>
		{/if}
	</div>

	<div class="foot">
		{#if changing}
			<form class="change" onsubmit={replan}>
				<label class="field grow">
					<span class="sr-only">Change the plan</span>
					<input type="text" bind:value={request} placeholder="e.g. not Sunday, Papa has puja" maxlength="200" />
				</label>
				<button class="btn accent" type="submit" disabled={replanning || !request.trim()}>
					{replanning ? 'Planning…' : 'Plan again'}
				</button>
			</form>
		{:else}
			<button class="btn quiet" type="button" onclick={() => (changing = true)}>Change it</button>
		{/if}
		<button class="btn quiet" type="button" onclick={notNow}>Not now</button>
	</div>
	{#if changeNote}<p class="tiny" role="status">{changeNote}</p>{/if}
</article>

<style>
	.weekend {
		display: flex;
		flex-direction: column;
		gap: 6px;
		padding: 14px 0 6px;
		border-top: 2px solid var(--rule);
		border-bottom: 1px solid var(--line);
	}
	.when {
		font-size: 2rem;
		line-height: 1.1;
		letter-spacing: -0.03em;
		font-weight: 500;
	}
	.yours {
		font-size: var(--t-small);
		font-weight: 400;
		letter-spacing: 0;
		color: var(--text-3);
		white-space: nowrap;
	}
	.who {
		font-size: var(--t-lead);
		line-height: 1.45;
	}
	.nm {
		white-space: nowrap;
	}
	.nm .dot {
		display: inline-block;
		width: 8px;
		height: 8px;
		margin: 0 5px 2px 1px;
		vertical-align: middle;
	}
	.who em {
		font-size: 1.12em;
	}
	.reason {
		color: var(--text-2);
	}
	.skipped {
		list-style: none;
		margin: 2px 0 0;
		padding: 0;
		color: var(--text-2);
		font-size: var(--t-small);
	}
	.alt {
		color: var(--text);
		font-weight: 500;
	}
	.trace {
		font-size: 0.75rem;
		letter-spacing: 0.02em;
		color: var(--text-3);
		padding: 2px 0 0 10px;
		border-left: 1px solid var(--line);
	}
	.main {
		margin-top: 10px;
	}
	.acts {
		display: flex;
		flex-wrap: wrap;
		column-gap: 20px;
		margin-top: 2px;
	}
	.inline {
		font-size: 1.12em;
	}
	.cal {
		display: flex;
		flex-wrap: wrap;
		column-gap: 16px;
		width: 100%;
		padding-left: 26px;
	}
	.small-btn {
		font-size: var(--t-small);
		color: var(--accent-ink);
		min-height: 44px;
	}
	.foot {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
	}
	.change {
		display: flex;
		align-items: flex-end;
		gap: 12px;
		flex: 1;
	}
</style>
