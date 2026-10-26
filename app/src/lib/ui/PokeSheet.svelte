<script lang="ts">
	// Poke: a short drafted line the user edits and sends in WhatsApp. Kizuna never sends anything itself.
	import type { Person } from '@kizuna/shared';
	import {
		answerCard,
		createInvite,
		draftPoke,
		markReached,
		suggestSlots,
		whatsappLink
	} from '#lib/core/index.js';
	import Sheet from './Sheet.svelte';
	import Icon from './Icon.svelte';

	let {
		open = $bindable(false),
		person,
		reason = '',
		promptId,
		onsent
	}: {
		open?: boolean;
		person: Person | undefined;
		reason?: string;
		promptId?: string;
		onsent?: () => void;
	} = $props();

	let text = $state('');
	let loading = $state(false);
	let fallback = $state(false);
	let triedAnother = $state(false);
	let withTime = $state(false);
	let timeBusy = $state(false);
	let timeNote = $state('');
	let sent = $state(false);
	let inviteSuffix = '';

	const simpleLine = (name: string) => `Hi ${name}, was thinking of you. How are things?`;

	async function draft() {
		if (!person) return;
		loading = true;
		fallback = false;
		try {
			const line = await draftPoke(person.id, reason);
			text = line + (withTime ? inviteSuffix : '');
		} catch {
			fallback = true;
			if (!text) text = simpleLine(person.name) + (withTime ? inviteSuffix : '');
		} finally {
			loading = false;
		}
	}

	// Fresh draft each time the sheet opens.
	let lastOpen = false;
	$effect(() => {
		if (open && !lastOpen) {
			text = '';
			triedAnother = false;
			withTime = false;
			inviteSuffix = '';
			timeNote = '';
			sent = false;
			draft();
		}
		lastOpen = open;
	});

	async function another() {
		triedAnother = true;
		await draft();
	}

	async function toggleTime() {
		if (!person) return;
		if (!withTime) {
			text = text.replace(inviteSuffix, '');
			return;
		}
		if (!inviteSuffix) {
			timeBusy = true;
			timeNote = '';
			try {
				const { slots } = await suggestSlots();
				if (!slots.length) throw new Error('no slots');
				const url = await createInvite(person.id, slots);
				inviteSuffix = `\n\nPick a time that suits you: ${url}`;
			} catch {
				withTime = false;
				timeNote = 'Couldn’t make a pick-a-time link just now. You can still send the line.';
				timeBusy = false;
				return;
			}
			timeBusy = false;
		}
		text = text.replace(inviteSuffix, '') + inviteSuffix;
	}

	async function send() {
		if (!person || !text.trim()) return;
		let link: string;
		try {
			link = whatsappLink(text.trim(), person.phone);
		} catch {
			const phone = person.phone ? person.phone.replace(/\D/g, '') : '';
			link = `https://wa.me/${phone}?text=${encodeURIComponent(text.trim())}`;
		}
		window.open(link, '_blank', 'noopener');
		sent = true;
		try {
			await markReached(person.id);
			if (promptId) await answerCard(promptId, 'poke');
		} catch {
			/* the message still went to WhatsApp */
		}
		onsent?.();
	}
</script>

<Sheet bind:open title={person ? `Poke ${person.name}` : 'Poke'}>
	{#if sent}
		<div class="done">
			<p class="big">Over to WhatsApp.</p>
			<p class="muted">Send it when it feels right.</p>
			<button class="btn block big" type="button" onclick={() => (open = false)}>Close</button>
		</div>
	{:else}
		{#if reason}<p class="muted small">{reason}</p>{/if}
		<label class="field">
			<span class="sr-only">Message</span>
			<textarea
				rows="4"
				bind:value={text}
				aria-busy={loading}
				placeholder={loading ? 'Finding the words…' : 'Say hello'}
				disabled={loading && !text}
			></textarea>
		</label>
		{#if fallback}
			<p class="note">Here’s a simple line to start. Change it however you like.</p>
		{/if}
		<div class="row wrap">
			{#if !triedAnother}
				<button class="btn" type="button" onclick={another} disabled={loading}>Try another</button>
			{/if}
			<label class="switch">
				<input type="checkbox" bind:checked={withTime} onchange={toggleTime} disabled={timeBusy} />
				<span class="track" aria-hidden="true"></span>
				<span>{timeBusy ? 'Finding times…' : 'Add a time'}</span>
			</label>
		</div>
		{#if timeNote}<p class="note">{timeNote}</p>{/if}
		<button class="btn primary block big" type="button" onclick={send} disabled={!text.trim() || loading}>
			<Icon name="send" size={20} /> Send in WhatsApp
		</button>
		<p class="tiny">You send it. Kizuna never messages anyone for you.</p>
	{/if}
</Sheet>

<style>
	.done {
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 8px 0;
	}
	.big {
		font-size: 1.375rem;
		font-weight: 620;
	}
	.done .btn {
		margin-top: 12px;
	}
	.switch {
		display: inline-flex;
		align-items: center;
		gap: 10px;
		min-height: var(--tap);
		padding: 0 6px;
		cursor: pointer;
		font-weight: 560;
		color: var(--text-2);
	}
	.switch input {
		position: absolute;
		opacity: 0;
		width: 1px;
		height: 1px;
	}
	.track {
		width: 42px;
		height: 26px;
		border-radius: 999px;
		background: var(--surface-2);
		border: 1px solid var(--line);
		position: relative;
		transition: background var(--dur) var(--ease);
	}
	.track::after {
		content: '';
		position: absolute;
		top: 2px;
		left: 2px;
		width: 20px;
		height: 20px;
		border-radius: 50%;
		background: var(--surface);
		box-shadow: 0 1px 3px rgb(0 0 0 / 0.2);
		transition: transform var(--dur) var(--ease);
	}
	.switch input:checked + .track {
		background: var(--accent);
		border-color: var(--accent);
	}
	.switch input:checked + .track::after {
		transform: translateX(16px);
	}
	.switch input:focus-visible + .track {
		outline: 3px solid var(--accent);
		outline-offset: 2px;
	}
</style>
