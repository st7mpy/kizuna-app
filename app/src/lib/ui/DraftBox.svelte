<script lang="ts">
	// A drafted line the user can edit, then send themselves through WhatsApp.
	import { whatsappLink } from '#lib/core/index.js';
	import { soft } from './motion.js';
	import { shareWithToast } from './toast.svelte.js';

	let {
		load,
		label = 'Your line',
		phone,
		share = false,
		tip = '',
		onopened,
		oncancel
	}: {
		/** Drafts the line; called once when the box appears. */
		load: () => Promise<{ line: string; link: string }>;
		label?: string;
		phone?: string;
		/** For a group (or no number): the phone's share sheet, else copy and open WhatsApp. */
		share?: boolean;
		/** A small one-liner shown after WhatsApp opens. */
		tip?: string;
		onopened?: () => void;
		oncancel?: () => void;
	} = $props();

	let text = $state('');
	let first = { line: '', link: '' };
	let loading = $state(true);
	let failed = $state(false);
	let opened = $state(false);

	$effect(() => {
		let gone = false;
		loading = true;
		load()
			.then((d) => {
				if (gone) return;
				first = d;
				text = d.line;
			})
			.catch(() => {
				if (!gone) failed = true;
			})
			.finally(() => {
				if (!gone) loading = false;
			});
		return () => (gone = true);
	});

	async function open() {
		const t = text.trim();
		if (!t) return;
		if (share) {
			if ((await shareWithToast(t)) === 'cancelled') return;
		} else {
			const link = t === first.line.trim() && first.link ? first.link : whatsappLink(t, phone);
			window.open(link, '_blank', 'noopener');
		}
		opened = true;
		onopened?.();
	}
</script>

<div class="draft" in:soft>
	<label class="field">
		<span>{label}</span>
		<textarea
			rows="3"
			bind:value={text}
			aria-busy={loading}
			placeholder={loading ? 'Finding the words…' : 'Write a line'}
			disabled={loading && !text}
		></textarea>
	</label>
	{#if failed}<p class="tiny">Couldn’t draft just now. Write your own line, it works the same.</p>{/if}
	<div class="row acts">
		<button class="btn primary" type="button" onclick={open} disabled={!text.trim()}>Open WhatsApp</button>
		{#if oncancel}<button class="btn quiet" type="button" onclick={oncancel}>Cancel</button>{/if}
	</div>
	{#if opened && tip}<p class="tiny tip" role="status" in:soft>{tip}</p>{/if}
</div>

<style>
	.draft {
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding-top: 6px;
	}
	.acts {
		gap: 18px;
	}
	.tip {
		color: var(--text-2);
	}
</style>
