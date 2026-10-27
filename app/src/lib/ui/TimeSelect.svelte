<script lang="ts">
	// A time picker that reads "18:30" like the rest of Kizuna (never "06:30 PM" on one screen only),
	// and stays narrow enough for a phone.
	import { timeOptions } from './freehours.js';

	let {
		value,
		label,
		onchange
	}: {
		value: string;
		label?: string;
		onchange: (v: string, el: HTMLSelectElement) => void;
	} = $props();

	const options = $derived(timeOptions([value]));
</script>

<select class="time num" aria-label={label} {value} onchange={(e) => onchange(e.currentTarget.value, e.currentTarget)}>
	{#each options as t (t)}
		<option value={t} selected={t === value}>{t}</option>
	{/each}
</select>

<style>
	.time {
		min-width: 0;
		width: 100%;
		font-variant-numeric: tabular-nums;
		appearance: none;
		-webkit-appearance: none;
		padding-right: 28px;
		background-image: linear-gradient(45deg, transparent 50%, var(--text-3) 50%),
			linear-gradient(135deg, var(--text-3) 50%, transparent 50%);
		background-position:
			calc(100% - 16px) 50%,
			calc(100% - 11px) 50%;
		background-size:
			5px 5px,
			5px 5px;
		background-repeat: no-repeat;
		cursor: pointer;
	}
</style>
