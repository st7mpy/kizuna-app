<script lang="ts" generics="T extends string">
	// A row of choices; one can be picked. Picked uses the accent.
	let {
		options,
		value,
		label,
		onchange
	}: {
		options: { value: T; label: string }[];
		value: T | null;
		label: string;
		onchange: (v: T) => void;
	} = $props();
</script>

<div class="seg" role="radiogroup" aria-label={label}>
	{#each options as o (o.value)}
		<button
			type="button"
			role="radio"
			aria-checked={value === o.value}
			class:on={value === o.value}
			onclick={() => onchange(o.value)}
		>
			{o.label}
		</button>
	{/each}
</div>

<style>
	.seg {
		display: grid;
		grid-auto-flow: column;
		grid-auto-columns: 1fr;
		gap: 4px;
		padding: 4px;
		background: var(--surface-2);
		border-radius: 999px;
	}
	button {
		appearance: none;
		min-height: 48px;
		border: 0;
		border-radius: 999px;
		background: transparent;
		color: var(--text-2);
		font: inherit;
		font-size: 1rem;
		font-weight: 560;
		cursor: pointer;
		transition:
			background var(--dur) var(--ease),
			color var(--dur) var(--ease);
	}
	button.on {
		background: var(--surface);
		color: var(--accent-ink);
		box-shadow: var(--shadow), inset 0 0 0 1.5px var(--accent);
	}
</style>
