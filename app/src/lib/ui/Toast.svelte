<script lang="ts">
	// The app's one toast, above the tab bar.
	import { hush, toast } from './toast.svelte.js';

	async function act() {
		const a = toast.action;
		hush();
		await a?.run();
	}
	import { soft } from './motion.js';
</script>

<div class="toast-zone" role="status" aria-live="polite">
	{#if toast.text}
		{#key toast.id}
			<p class="toast" class:has-action={!!toast.action} in:soft={{ y: 10 }}>
				<span>{toast.text}</span>
				{#if toast.action}
					<button class="act" type="button" onclick={act}>{toast.action.label}</button>
				{/if}
			</p>
		{/key}
	{/if}
</div>

<style>
	.toast-zone {
		position: fixed;
		left: 0;
		right: 0;
		bottom: calc(var(--nav-h, 76px) + 14px);
		display: flex;
		justify-content: center;
		padding: 0 16px;
		pointer-events: none;
		z-index: 60;
	}
	.toast {
		max-width: 420px;
		padding: 12px 18px;
		border-radius: 999px;
		background: var(--rule);
		color: var(--on-rule);
		font-size: var(--t-small);
		font-weight: 500;
		box-shadow: var(--shadow);
		text-align: center;
	}
	.toast.has-action {
		display: flex;
		align-items: center;
		gap: 14px;
		padding: 6px 8px 6px 18px;
		pointer-events: auto;
	}
	.act {
		appearance: none;
		border: 0;
		min-height: 40px;
		padding: 0 14px;
		border-radius: 999px;
		background: transparent;
		color: inherit;
		font: inherit;
		font-weight: 600;
		text-decoration: underline;
		text-underline-offset: 3px;
		cursor: pointer;
	}
	.act:focus-visible {
		outline: 2px solid currentColor;
		outline-offset: 2px;
	}
	@media (min-width: 1100px) {
		.toast-zone {
			bottom: 28px;
		}
	}
</style>
