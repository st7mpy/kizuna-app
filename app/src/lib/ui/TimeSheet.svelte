<script lang="ts">
	// Find a time: two free slots, a pick-a-time link to share, and a way into the user's calendar.
	import type { Person, Slot } from '@kizuna/shared';
	import {
		answerCard,
		createInvite,
		googleCalendarLink,
		icsFile,
		suggestSlots,
		whatsappLink
	} from '#lib/core/index.js';
	import Sheet from './Sheet.svelte';
	import Icon from './Icon.svelte';

	let {
		open = $bindable(false),
		person,
		promptId,
		onshared
	}: {
		open?: boolean;
		person: Person | undefined;
		promptId?: string;
		onshared?: () => void;
	} = $props();

	let request = $state('');
	let slots = $state<Slot[]>([]);
	let note = $state<string | null>(null);
	let picked = $state(0);
	let loading = $state(false);
	let failed = $state(false);
	let shareFailed = $state(false);
	let sharing = $state(false);
	let shared = $state(false);
	let inviteUrl = '';
	// Each lookup gets a number; an answer for an older one (or a closed sheet) is ignored.
	let seq = 0;

	async function find(req?: string) {
		const my = ++seq;
		loading = true;
		failed = false;
		shareFailed = false;
		inviteUrl = '';
		try {
			const r = await suggestSlots(req?.trim() || undefined);
			if (my !== seq || !open) return;
			slots = r.slots.slice(0, 2);
			note = r.note;
			picked = 0;
		} catch {
			if (my !== seq) return;
			failed = true;
			slots = [];
		} finally {
			if (my === seq) loading = false;
		}
	}

	let lastOpen = false;
	$effect(() => {
		if (open && !lastOpen) {
			request = '';
			shared = false;
			slots = [];
			note = null;
			find();
		}
		if (!open && lastOpen) {
			seq++;
			loading = false;
		}
		lastOpen = open;
	});

	const title = () => (person ? `Catch up with ${person.name}` : 'Catch up');

	async function share() {
		if (!person || !slots.length) return;
		sharing = true;
		shareFailed = false;
		try {
			if (!inviteUrl) inviteUrl = await createInvite(person.id, slots, person.name);
			const line = 'Want to catch up? Pick a time that suits you.';
			let done = false;
			if (navigator.share) {
				try {
					await navigator.share({ text: line, url: inviteUrl });
					done = true;
				} catch (e) {
					if ((e as DOMException)?.name === 'AbortError') return;
				}
			}
			if (!done) window.open(whatsappLink(`${line} ${inviteUrl}`, person.phone), '_blank', 'noopener');
			shared = true;
			if (promptId) answerCard(promptId, 'time').catch(() => {});
			onshared?.();
		} catch {
			shareFailed = true;
		} finally {
			sharing = false;
		}
	}

	function google() {
		const s = slots[picked];
		if (s) window.open(googleCalendarLink(s, title()), '_blank', 'noopener');
	}

	function ics() {
		const s = slots[picked];
		if (!s) return;
		const url = URL.createObjectURL(icsFile(s, title()));
		const a = document.createElement('a');
		a.href = url;
		a.download = `${title().toLowerCase().replace(/[^a-z0-9]+/g, '-')}.ics`;
		a.click();
		setTimeout(() => URL.revokeObjectURL(url), 2000);
	}
</script>

<Sheet bind:open title={person ? 'A time with' : 'Find a time'} em={person?.name}>
	<form
		class="ask"
		onsubmit={(e) => {
			e.preventDefault();
			find(request);
		}}
	>
		<label class="field grow">
			<span>When</span>
			<input type="text" bind:value={request} placeholder="e.g. next weekend, not Sunday" enterkeyhint="search" />
		</label>
		<button class="icon-btn solid" type="submit" disabled={loading} aria-label="Look">
			<Icon name="arrow" size={20} />
		</button>
	</form>

	<div class="slots" role="radiogroup" aria-label="Times you're free" aria-busy={loading}>
		{#if loading}
			<div class="slot ghost" aria-hidden="true"></div>
			<div class="slot ghost" aria-hidden="true"></div>
			<p class="sr-only" aria-live="polite">Looking at your free hours…</p>
		{:else if failed}
			<p class="note">Couldn’t look at times just now. Try again in a moment.</p>
		{:else if !slots.length}
			<p class="note">{note ?? 'No free hours fit that. Try another day, or add free hours in Settings.'}</p>
		{:else}
			{#each slots as s, i (s.start)}
				{@const [day, span = ''] = s.label.split(', ')}
				{@const [from, to] = span.split(' to ')}
				<button
					type="button"
					class="slot"
					role="radio"
					aria-checked={picked === i}
					aria-label={s.label}
					class:on={picked === i}
					onclick={() => (picked = i)}
				>
					<span class="when">
						<span class="label">{day}</span>
						<span class="time num">{from}{#if to}<span class="to">to {to}</span>{/if}</span>
					</span>
					<span class="radio" aria-hidden="true"></span>
				</button>
			{/each}
			{#if note}<p class="note">{note}</p>{/if}
		{/if}
	</div>

	{#if shared}
		<p class="note" aria-live="polite">Link shared. You’ll see their pick when they open it.</p>
	{:else if shareFailed}
		<p class="note" role="alert">Couldn’t make the link just now. Try again.</p>
	{/if}
	<button class="btn primary block big" type="button" onclick={share} disabled={!slots.length || sharing}>
		<Icon name="share" size={20} />
		{sharing ? 'Making the link…' : 'Share pick-a-time link'}
	</button>

	<div class="cal">
		<span class="label">Add to my calendar</span>
		<div class="row">
			<button class="btn" type="button" onclick={google} disabled={!slots.length} aria-label="Add to Google Calendar">
				<Icon name="calendar" size={20} /> Google
			</button>
			<button class="btn" type="button" onclick={ics} disabled={!slots.length} aria-label="Download a calendar file">
				<Icon name="download" size={20} /> .ics file
			</button>
		</div>
	</div>
</Sheet>

<style>
	.ask {
		display: flex;
		align-items: flex-end;
		gap: 12px;
	}
	.ask .icon-btn {
		margin-bottom: 2px;
	}
	.slots {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.slot {
		appearance: none;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		min-height: 84px;
		padding: 14px 18px;
		border: 0;
		border-radius: 18px;
		background: var(--surface);
		box-shadow: inset 0 0 0 1px var(--line);
		color: var(--text-2);
		font: inherit;
		text-align: left;
		cursor: pointer;
		transition:
			color var(--dur) var(--ease),
			background var(--dur) var(--ease),
			box-shadow var(--dur) var(--ease);
	}
	.when {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.time {
		font-size: 2rem;
		line-height: 1.05;
		font-weight: 500;
		letter-spacing: -0.04em;
	}
	.to {
		margin-left: 0.35em;
		font-size: 1.125rem;
		letter-spacing: -0.01em;
		color: var(--text-3);
	}
	.slot.on {
		color: var(--text);
		background: var(--accent-soft);
		box-shadow: inset 0 0 0 1px var(--accent-line);
	}
	.slot.on .label {
		color: var(--accent-ink);
	}
	.radio {
		flex: none;
		width: 24px;
		height: 24px;
		border-radius: 50%;
		box-shadow: inset 0 0 0 1.5px var(--line-2);
		transition: box-shadow var(--dur) var(--ease);
	}
	.slot.on .radio {
		box-shadow:
			inset 0 0 0 1.5px var(--accent),
			inset 0 0 0 6px var(--surface-solid),
			inset 0 0 0 12px var(--accent);
	}
	.slot:focus-visible {
		outline-offset: -2px;
	}
	.ghost {
		background: linear-gradient(90deg, transparent, var(--sunk), transparent);
		opacity: 0.8;
	}
	.cal {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
		flex-wrap: wrap;
	}
	.cal .row {
		gap: 18px;
	}
	.cal .btn {
		font-size: var(--t-small);
		color: var(--text-2);
	}
</style>
