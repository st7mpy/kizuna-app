<script lang="ts">
	// A soft hint for the guided first run: a small glowing pill. Tapping it (or the thing it points at) moves on.
	import { soft } from './motion.js';
	let { text, onpass }: { text: string; onpass: () => void } = $props();
</script>

<button class="hint" type="button" in:soft onclick={onpass}>
	<span class="dot" aria-hidden="true"></span>
	{text}
</button>

<style>
	.hint {
		align-self: flex-start;
		display: inline-flex;
		align-items: center;
		gap: 8px;
		min-height: 40px;
		padding: 8px 14px 8px 12px;
		border: 0;
		border-radius: 999px;
		background: color-mix(in srgb, var(--accent) 14%, var(--surface-solid));
		color: var(--accent-ink);
		font: 500 var(--t-small) / 1.3 var(--sans);
		text-align: left;
		max-width: 100%;
		cursor: pointer;
	}
	.dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: var(--accent);
		box-shadow: 0 0 0 0 color-mix(in srgb, var(--accent) 50%, transparent);
		animation: beckon 2.4s ease-out infinite;
	}
	@keyframes beckon {
		0% {
			box-shadow: 0 0 0 0 color-mix(in srgb, var(--accent) 50%, transparent);
		}
		70%,
		100% {
			box-shadow: 0 0 0 8px transparent;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.dot {
			animation: none;
		}
	}
</style>
