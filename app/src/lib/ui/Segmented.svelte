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

	// A radio group: one Tab stop (the picked option, or the first), arrow keys move and pick.
	const focusIndex = $derived(Math.max(0, options.findIndex((o) => o.value === value)));
	let group: HTMLDivElement;
	function onkey(e: KeyboardEvent, i: number) {
		const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
		const to = e.key === 'Home' ? 0 : e.key === 'End' ? options.length - 1 : step ? (i + step + options.length) % options.length : -1;
		if (to < 0) return;
		e.preventDefault();
		onchange(options[to].value);
		group?.querySelectorAll<HTMLButtonElement>('button')[to]?.focus();
	}
</script>

<div class="seg" role="radiogroup" aria-label={label} bind:this={group}>
	{#each options as o, i (o.value)}
		<button
			type="button"
			role="radio"
			aria-checked={value === o.value}
			tabindex={i === focusIndex ? 0 : -1}
			class:on={value === o.value}
			onclick={() => onchange(o.value)}
			onkeydown={(e) => onkey(e, i)}
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
