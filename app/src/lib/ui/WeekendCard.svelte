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
	import { skippedLine, traceLine, whenLocal, yourTime } from './mapformat.js';
	import { cap } from './format.js';
	import DraftBox from './DraftBox.svelte';
	import Icon from './Icon.svelte';
	import Hint from './Hint.svelte';
	import { passTour, tour } from './tour.svelte.js';

	let {
		card,
		people,
		zoneOf,
		ondismiss
	}: {
		card: WeekendCard;
		people: Map<string, Person>;
		/** Their time zone, when known (the map knows it), so another time can say what it is for them. */
		zoneOf?: (personId: string) => string | null | undefined;
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

	/** "Saturday 12:00 your time instead? That's 10:00 for Jordan." Never two bare times side by side. */
	function altLine(personId: string, start: string, theirTz?: string): string {
		const mine = `${whenLocal(start)} ${yourTime()} instead?`;
		const tz = theirTz || zoneOf?.(personId);
		if (!tz) return mine;
		const theirs = whenLocal(start, tz);
		if (theirs === whenLocal(start)) return mine;
		const [day, time] = theirs.split(' ');
		const sameDay = whenLocal(start).split(' ')[0] === day;
		return `${mine} That’s ${sameDay ? time : theirs} for ${nameOf(personId)}.`;
	}

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

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
<article class="weekend" aria-labelledby="wk-{uid}" onclick={() => passTour(2)}>
	{#if tour.step === 2}<Hint text="Here’s this weekend’s call" onpass={() => passTour(2)} />{/if}
	<p class="label">This weekend</p>
	<h2 id="wk-{uid}" class="when">
		<span class="num">{when}</span> <span class="yours">{yourTime()}</span>
	</h2>
	{#if free.length}
		<p class="who">
			{#each free as id, i (id)}<span class="nm"
					><span class="dot" style="--hue:{hueFor(id)}" aria-hidden="true"></span><em>{nameOf(id)}</em></span
				>{i < free.length - 2 ? ', ' : i === free.length - 2 ? ' and ' : ''}{/each}
			{free.length === 1 ? 'is' : 'are'} free.
		</p>
	{/if}
	{#if c.reason}<p class="reason">{cap(c.reason)}</p>{/if}

	{#if c.skipped.length}
		<ul class="skipped">
			{#each c.skipped as s (s.personId)}
				<li>
					{skippedLine(nameOf(s.personId), s.why)}
					{#if s.alt}<span class="alt">{altLine(s.personId, s.alt.start, s.tz)}</span>{/if}
				</li>
			{/each}
		</ul>
	{/if}

	{#if c.steps?.length}
		<details class="how">
			<summary>How Kizuna planned this</summary>
			<ol>
				{#each c.steps as step, i (step.tool + i)}
					<li><code>{step.tool}</code><span>{step.line}</span></li>
				{/each}
			</ol>
			<p class="by">
				{c.by === 'spark' ? 'Planned by Meta’s Spark model, then checked on your phone.' : 'Planned on your phone. Spark takes over when it answers.'}
			</p>
		</details>
	{:else if trace}<p class="trace" aria-label="How Kizuna found this: {trace}">{trace}</p>{/if}

	{#if drafting === 'group'}
		<DraftBox
			label="For the family group"
			what="group"
			share
			load={(quick) => draftForGroup(c, quick)}
			tip={WHATSAPP_SCHEDULE_TIP}
			onopened={() => opened('group')}
			oncancel={() => (drafting = null)}
		/>
	{:else if drafting}
		{@const id = drafting}
		<DraftBox
			label="For {nameOf(id)}"
			phone={people.get(id)?.phone}
			load={(quick) => draftForPerson(c, id, quick)}
			tip={WHATSAPP_SCHEDULE_TIP}
			oncancel={() => (drafting = null)}
		/>
	{/if}

	{#if drafting !== 'group'}
		{#if tour.step === 3}<Hint text="Send it to the family" onpass={() => passTour(3)} />{/if}
		<button class="btn primary big main" type="button" onclick={() => { passTour(3); drafting = 'group'; }}>
			Draft for the family group
		</button>
	{/if}
	<div class="acts">
		{#each c.skipped as s (s.personId)}
			{#if drafting !== s.personId}
				<button class="btn" type="button" onclick={() => (drafting = s.personId)}>
					<span>Draft for <em class="inline">{nameOf(s.personId)}</em></span>
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
					<input type="text" bind:value={request} placeholder="e.g. not Sunday, Dad has a game" maxlength="200" />
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
		padding: 20px 20px 10px;
		border-radius: var(--r-card);
		background:
			radial-gradient(120% 70% at 100% 0%, color-mix(in srgb, var(--dawn-peach) 26%, transparent), transparent 70%),
			radial-gradient(100% 70% at 0% 0%, color-mix(in srgb, var(--dawn-sky) 22%, transparent), transparent 70%),
			var(--surface);
		box-shadow: var(--card-shadow);
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
		padding: 2px 0 0;
	}
	.how {
		font-size: var(--t-small);
		color: var(--text-2);
		margin-top: 4px;
	}
	.how summary {
		cursor: pointer;
		min-height: 44px;
		display: flex;
		align-items: center;
		gap: 6px;
		color: var(--text-3);
		list-style: none;
	}
	.how summary::-webkit-details-marker {
		display: none;
	}
	.how summary::after {
		content: '';
		width: 6px;
		height: 6px;
		border-right: 1.5px solid currentColor;
		border-bottom: 1.5px solid currentColor;
		transform: rotate(45deg) translateY(-2px);
		transition: transform 0.2s var(--ease, ease);
	}
	.how[open] summary::after {
		transform: rotate(225deg) translateY(-1px);
	}
	.how ol {
		list-style: none;
		margin: 4px 0 0;
		padding: 0 0 0 10px;
		border-left: 1px solid var(--line, color-mix(in srgb, var(--text) 14%, transparent));
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.how li {
		display: flex;
		flex-direction: column;
		gap: 1px;
	}
	.how code {
		font: 500 0.72rem/1.3 var(--sans);
		letter-spacing: 0.02em;
		color: var(--accent-ink);
	}
	.how .by {
		margin-top: 6px;
		font-size: 0.75rem;
		color: var(--text-3);
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
		font-weight: 600;
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
