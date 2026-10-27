<script lang="ts" generics="T extends string">
	// A row of choices; one can be picked. Picked is underlined.
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
	/* A soft pill track; the picked word sits on a raised surface. */
	.seg {
		display: grid;
		grid-auto-flow: column;
		grid-auto-columns: 1fr;
		gap: 4px;
		padding: 4px;
		border-radius: 999px;
		background: var(--bg-2);
		box-shadow: inset 0 0 0 1px var(--line);
	}
	button {
		appearance: none;
		position: relative;
		min-height: 44px;
		padding: 0 12px;
		border: 0;
		border-radius: 999px;
		background: transparent;
		color: var(--text-3);
		font: inherit;
		font-size: var(--t-body);
		font-weight: 500;
		letter-spacing: -0.01em;
		text-align: center;
		cursor: pointer;
		transition:
			color var(--dur) var(--ease),
			background var(--dur) var(--ease),
			box-shadow var(--dur) var(--ease);
	}
	button:hover {
		color: var(--text);
	}
	button.on {
		color: var(--text);
		background: var(--surface);
		box-shadow: var(--card-shadow);
	}
	button:focus-visible {
		border-radius: 999px;
	}
</style>
