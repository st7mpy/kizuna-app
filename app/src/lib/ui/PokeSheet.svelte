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
	import Seal from './Seal.svelte';

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

<Sheet bind:open title={person ? 'Say hi to' : 'Say hi'} em={person?.name}>
	{#if sent}
		<div class="done">
			<Seal size={84} />
			<p class="calm">Over to <em>WhatsApp</em>.</p>
			<p class="muted">Send it when it feels right.</p>
			<button class="btn line block big" type="button" onclick={() => (open = false)}>Close</button>
		</div>
	{:else}
		{#if reason}<p class="muted why">{reason}</p>{/if}
		<label class="field draft">
			<span>Your line</span>
			<textarea
				rows="3"
				bind:value={text}
				aria-busy={loading}
				placeholder={loading ? 'Finding the words…' : 'Say hello'}
				disabled={loading && !text}
			></textarea>
		</label>
		{#if fallback}
			<p class="note">Here’s a simple line to start. Change it however you like.</p>
		{/if}
		<div class="row tools">
			{#if !triedAnother}
				<button class="btn" type="button" onclick={another} disabled={loading}>
					<Icon name="refresh" size={20} /> Try another
				</button>
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
	.why {
		margin-top: -8px;
	}
	.draft textarea {
		font-size: 1.3125rem;
		line-height: 1.4;
		letter-spacing: -0.01em;
		padding: 12px 0 14px;
	}
	.tools {
		justify-content: space-between;
		margin-top: -8px;
	}
	.done {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 10px;
		padding: 4px 0;
	}
	.done :global(.seal) {
		margin-bottom: 8px;
	}
	.done .btn {
		margin-top: 16px;
	}
	.switch {
		display: inline-flex;
		align-items: center;
		gap: 10px;
		min-height: var(--tap);
		cursor: pointer;
		font-weight: 500;
		color: var(--text);
	}
	.switch input {
		position: absolute;
		opacity: 0;
		width: 1px;
		height: 1px;
	}
	.track {
		width: 40px;
		height: 24px;
		border-radius: 999px;
		box-shadow: inset 0 0 0 1.5px var(--text-3);
		position: relative;
		transition: background var(--dur) var(--ease);
	}
	.track::after {
		content: '';
		position: absolute;
		top: 5px;
		left: 5px;
		width: 14px;
		height: 14px;
		border-radius: 50%;
		background: var(--text-3);
		transition:
			transform var(--dur) var(--ease),
			background var(--dur) var(--ease);
	}
	.switch input:checked + .track {
		background: var(--accent);
		box-shadow: none;
	}
	.switch input:checked + .track::after {
		transform: translateX(16px);
		background: var(--on-accent);
	}
	.switch input:focus-visible + .track {
		outline: 2px solid var(--accent);
		outline-offset: 3px;
	}
</style>
