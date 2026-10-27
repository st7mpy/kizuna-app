<script lang="ts">
	// The app's one toast, above the tab bar.
	import { toast } from './toast.svelte.js';
	import { soft } from './motion.js';
</script>

<div class="toast-zone" role="status" aria-live="polite">
	{#if toast.text}
		{#key toast.id}
			<p class="toast" in:soft={{ y: 10 }}>{toast.text}</p>
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
	@media (min-width: 1100px) {
		.toast-zone {
			bottom: 28px;
		}
	}
</style>
