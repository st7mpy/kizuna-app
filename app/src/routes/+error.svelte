<script lang="ts">
	// Any page that isn't here (or failed to open): a calm note and a way back.
	import { page } from '$app/state';
	const missing = $derived(page.status === 404);
</script>

<svelte:head><title>{missing ? 'Not here' : 'Something went wrong'} · Kizuna</title></svelte:head>

<div class="page">
	<div class="stack lost">
		<p class="label">{missing ? 'Not here' : 'Something went wrong'}</p>
		<h1 class="calm">{missing ? 'There’s nothing at this address.' : 'This page didn’t open.'}</h1>
		<p class="muted">
			{missing ? 'The link may be old, or a letter may be off.' : 'Try again in a moment. Your notes are safe on this phone.'}
		</p>
		<div class="row">
			<a class="btn primary" href="/">Back to Today</a>
			<a class="btn line" href="/map">Open the map</a>
		</div>
	</div>
</div>

<style>
	.lost {
		gap: 14px;
		padding-top: 24px;
	}
	.row {
		flex-wrap: wrap;
		gap: 10px;
		margin-top: 8px;
	}
</style>
