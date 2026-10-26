<script lang="ts">
	// Bottom sheet built on <dialog>: focus stays inside, Escape and the scrim close it.
	import type { Snippet } from 'svelte';
	import Icon from './Icon.svelte';

	let {
		open = $bindable(false),
		title,
		onclose,
		children
	}: { open?: boolean; title: string; onclose?: () => void; children: Snippet } = $props();

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
		<header class="spread">
			<h2 id="sheet-{titleId}">{title}</h2>
			<button class="icon-btn" type="button" aria-label="Close" onclick={() => (open = false)}>
				<Icon name="close" />
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
		animation: fade var(--dur) var(--ease);
	}
	dialog[open] .sheet {
		animation: up 320ms var(--ease);
	}
	.sheet {
		background: var(--bg);
		border-radius: 28px 28px 0 0;
		padding: 8px 20px calc(24px + var(--safe-b));
		max-height: 92dvh;
		overflow-y: auto;
		display: flex;
		flex-direction: column;
		gap: 16px;
		box-shadow: 0 -10px 40px -12px rgb(0 0 0 / 0.25);
	}
	.grab {
		width: 40px;
		height: 4px;
		border-radius: 4px;
		background: var(--line);
		margin: 4px auto 0;
	}
	header {
		margin-right: -10px;
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
</style>
