<script lang="ts">
	// The landing page, always reachable. With notes on this device the main button opens the app
	// instead of loading the sample family, so nothing gets replaced.
	import Landing from '#lib/landing/Landing.svelte';
	import { hasAnyData } from '#lib/db.js';
	import { watch } from '#lib/ui/live.svelte.js';

	const hasData = watch(() => hasAnyData(), false);
	// Decided once, so loading the sample doesn't swap the buttons mid-way.
	let returning = $state<boolean | null>(null);
	$effect(() => {
		if (returning === null && hasData.ready) returning = hasData.value;
	});
</script>

<svelte:head><title>About · Kizuna</title></svelte:head>

{#if returning !== null}
	<Landing {returning} />
{/if}
