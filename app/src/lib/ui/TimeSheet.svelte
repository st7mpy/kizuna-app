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
	let sharing = $state(false);
	let shared = $state(false);
	let inviteUrl = '';

	async function find(req?: string) {
		loading = true;
		failed = false;
		inviteUrl = '';
		try {
			const r = await suggestSlots(req?.trim() || undefined);
			slots = r.slots.slice(0, 2);
			note = r.note;
			picked = 0;
		} catch {
			failed = true;
			slots = [];
		} finally {
			loading = false;
		}
	}

	let lastOpen = false;
	$effect(() => {
		if (open && !lastOpen) {
			request = '';
			shared = false;
			find();
		}
		lastOpen = open;
	});

	const title = () => (person ? `Catch up with ${person.name}` : 'Catch up');

	async function share() {
		if (!person || !slots.length) return;
		sharing = true;
		try {
			if (!inviteUrl) inviteUrl = await createInvite(person.id, slots);
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
			failed = true;
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

<Sheet bind:open title={person ? `A time with ${person.name}` : 'Find a time'}>
	<form
		class="ask"
		onsubmit={(e) => {
			e.preventDefault();
			find(request);
		}}
	>
		<label class="field grow">
			<span>When?</span>
			<input type="text" bind:value={request} placeholder="e.g. next weekend, not Sunday" enterkeyhint="search" />
		</label>
		<button class="btn" type="submit" disabled={loading}>Look</button>
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
				<button
					type="button"
					class="slot"
					role="radio"
					aria-checked={picked === i}
					class:on={picked === i}
					onclick={() => (picked = i)}
				>
					<Icon name="clock" size={20} />
					<span>{s.label}</span>
				</button>
			{/each}
			{#if note}<p class="note">{note}</p>{/if}
		{/if}
	</div>

	{#if shared}
		<p class="note" aria-live="polite">Link shared. You’ll see their pick when they open it.</p>
	{/if}
	<button class="btn primary block big" type="button" onclick={share} disabled={!slots.length || sharing}>
		<Icon name="share" size={20} />
		{sharing ? 'Making the link…' : 'Share pick-a-time link'}
	</button>

	<div class="stack cal">
		<p class="label">Add to my calendar</p>
		<div class="row">
			<button class="btn grow" type="button" onclick={google} disabled={!slots.length} aria-label="Add to Google Calendar">
				<Icon name="calendar" size={20} /> Google
			</button>
			<button class="btn grow" type="button" onclick={ics} disabled={!slots.length} aria-label="Download a calendar file">
				<Icon name="download" size={20} /> .ics file
			</button>
		</div>
	</div>
</Sheet>

<style>
	.ask {
		display: flex;
		align-items: flex-end;
		gap: 8px;
	}
	.grow {
		flex: 1;
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
		gap: 12px;
		min-height: 60px;
		padding: 0 18px;
		border-radius: var(--radius-s);
		border: 1px solid var(--line);
		background: var(--surface);
		color: var(--text);
		font: inherit;
		font-weight: 560;
		text-align: left;
		cursor: pointer;
		transition:
			border-color var(--dur) var(--ease),
			background var(--dur) var(--ease);
	}
	.slot :global(svg) {
		color: var(--text-3);
	}
	.slot.on {
		border-color: var(--accent);
		box-shadow: inset 0 0 0 1px var(--accent);
		background: var(--accent-soft);
	}
	.slot.on :global(svg) {
		color: var(--accent-ink);
	}
	.ghost {
		background: var(--surface-2);
		border-color: transparent;
		opacity: 0.7;
	}
	.cal {
		gap: 8px;
		padding-top: 4px;
	}
	.cal .btn {
		padding: 0 12px;
		font-size: 0.9375rem;
	}
</style>
