<script lang="ts">
	// Bottom sheet built on <dialog>: focus stays inside, Escape and the scrim close it.
	import type { Snippet } from 'svelte';
	import Icon from './Icon.svelte';

	let {
		open = $bindable(false),
		title,
		em,
		onclose,
		children
	}: {
		open?: boolean;
		title: string;
		/** Set after the title in the italic serif, e.g. a name. */
		em?: string;
		onclose?: () => void;
		children: Snippet;
	} = $props();

	let dialog: HTMLDialogElement | undefined = $state();
	const titleId = $props.id();

	$effect(() => {
		if (!dialog) return;
		if (open && !dialog.open) dialog.showModal();
		if (!open && dialog.open) dialog.close();
	});

	function closed() {
		if (open) open = false;
		onclose?.();
	}
</script>

<dialog
	bind:this={dialog}
	aria-labelledby="sheet-{titleId}"
	onclose={closed}
	onclick={(e) => {
		if (e.target === dialog) open = false;
	}}
>
	<div class="sheet">
		<div class="grab" aria-hidden="true"></div>
		<header>
			<h2 id="sheet-{titleId}">{title}{#if em}{' '}<em>{em}</em>{/if}</h2>
			<button class="icon-btn solid" type="button" aria-label="Close" onclick={() => (open = false)}>
				<Icon name="close" size={20} />
			</button>
		</header>
		{#if open}
			{@render children()}
		{/if}
	</div>
</dialog>

<style>
	dialog {
		margin: auto auto 0;
		padding: 0;
		border: 0;
		width: 100%;
		max-width: 560px;
		max-height: 92dvh;
		background: transparent;
		color: inherit;
		overflow: visible;
	}
	dialog::backdrop {
		background: var(--scrim);
		backdrop-filter: blur(2px);
		animation: fade var(--dur) var(--ease);
	}
	dialog[open] .sheet {
		animation: up 320ms var(--ease);
	}
	.sheet {
		background: var(--surface);
		border-radius: 24px 24px 0 0;
		box-shadow: inset 0 1px 0 var(--line);
		padding: 8px var(--gutter) calc(24px + var(--safe-b));
		max-height: 92dvh;
		overflow-y: auto;
		display: flex;
		flex-direction: column;
		gap: 20px;
	}
	.grab {
		width: 36px;
		height: 3px;
		border-radius: 3px;
		background: var(--line);
		margin: 4px auto 0;
	}
	header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 16px;
		padding-top: 6px;
	}
	h2 {
		font-size: var(--t-title);
		line-height: 1.08;
		font-weight: 500;
		letter-spacing: -0.03em;
		padding-top: 4px;
	}
	h2 em {
		font-size: 1.1em;
	}
	@keyframes up {
		from {
			transform: translateY(40%);
			opacity: 0.4;
		}
		to {
			transform: none;
			opacity: 1;
		}
	}
	/* Wider screens: a centred card instead of a bottom sheet. */
	@media (min-width: 720px) {
		dialog {
			margin: auto;
			max-width: 520px;
			max-height: 88dvh;
		}
		.sheet {
			border-radius: 24px;
			box-shadow: inset 0 0 0 1px var(--line);
			padding: 12px 28px 28px;
			max-height: 88dvh;
		}
		.grab {
			display: none;
		}
		dialog[open] .sheet {
			animation: pop 260ms var(--ease);
		}
	}
	@keyframes pop {
		from {
			transform: translateY(12px) scale(0.98);
			opacity: 0;
		}
		to {
			transform: none;
			opacity: 1;
		}
	}
</style>
