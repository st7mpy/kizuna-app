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
	/* Words on a hairline; the picked one is underlined in ink. */
	.seg {
		display: grid;
		grid-auto-flow: column;
		grid-auto-columns: 1fr;
		border-bottom: 1px solid var(--line);
	}
	button {
		appearance: none;
		position: relative;
		min-height: 52px;
		padding: 0;
		border: 0;
		border-radius: 0;
		background: transparent;
		color: var(--text-3);
		font: inherit;
		font-size: var(--t-body);
		font-weight: 500;
		letter-spacing: -0.01em;
		text-align: left;
		cursor: pointer;
		transition: color var(--dur) var(--ease);
	}
	button::after {
		content: '';
		position: absolute;
		left: 0;
		right: 14px;
		bottom: -1px;
		height: 2px;
		background: var(--text);
		transform: scaleX(0);
		transform-origin: left;
		transition: transform var(--dur) var(--ease);
	}
	button.on {
		color: var(--text);
	}
	button.on::after {
		transform: none;
	}
	button:focus-visible {
		border-radius: 4px;
	}
</style>
