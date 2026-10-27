<script lang="ts">
	// A drafted line the user can edit, then send themselves through WhatsApp.
	import { whatsappLink } from '#lib/core/index.js';
	import { soft } from './motion.js';
	import { shareWithToast } from './toast.svelte.js';
	import { autogrow } from './autogrow.js';

	let {
		load,
		label = 'Your line',
		phone,
		share = false,
		tip = '',
		onopened,
		oncancel
	}: {
		/**
		 * Drafts the line; called once when the box appears. It may hand over a simple line at once
		 * through `quick`, which shows while the model drafts (and stays if the model is slow).
		 */
		load: (quick: (line: string) => void) => Promise<{ line: string; link: string }>;
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
	let edited = false; // the user's own words are never replaced by a late draft

	$effect(() => {
		let gone = false;
		loading = true;
		load((line) => {
			if (!gone && !edited && !text.trim()) text = line;
		})
			.then((d) => {
				if (gone) return;
				first = d;
				if (!edited) text = d.line;
			})
			.catch(() => {
				if (!gone && !text.trim()) failed = true;
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
	<label class="field" class:improving={loading && !!text}>
		<span>{label}</span>
		<textarea
			rows="3"
			bind:value={text}
			use:autogrow={text}
			oninput={() => (edited = true)}
			aria-busy={loading}
			placeholder={loading ? 'Finding the words…' : 'Write a line'}
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
	textarea {
		resize: none;
	}
	/* While a warmer line is on its way: a soft light passes over the words. */
	.improving textarea {
		background-image: linear-gradient(
			100deg,
			transparent 35%,
			color-mix(in srgb, var(--accent) 9%, transparent) 50%,
			transparent 65%
		);
		background-size: 300% 100%;
		background-repeat: no-repeat;
		animation: sheen 1.8s linear infinite;
	}
	@keyframes sheen {
		from {
			background-position: 100% 0;
		}
		to {
			background-position: 0 0;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.improving textarea {
			animation: none;
			background-position: 50% 0;
		}
	}
</style>
