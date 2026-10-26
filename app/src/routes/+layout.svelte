<script lang="ts">
	import '../app.css';
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { startCore } from '#lib/core/index.js';
	import Mark from '#lib/ui/Mark.svelte';
	import NavBar from '#lib/ui/NavBar.svelte';
	import type { LayoutProps } from './$types';

	let { children }: LayoutProps = $props();

	// Quietly understand any notes left from before (offline, closed tab), then weave if due.
	onMount(() => {
		try {
			startCore();
		} catch {
			/* nothing to catch up on yet */
		}
	});
</script>

<div class="shell">
	<header>
		<a href="/" class="brand" aria-label="Kizuna, Today">
			<Mark size={30} />
			<span class="word">Kizuna</span>
		</a>
	</header>
	<main id="main">
		{#key page.url.pathname}
			{@render children()}
		{/key}
	</main>
	<NavBar />
</div>

<style>
	.shell {
		max-width: 560px;
		margin: 0 auto;
		min-height: 100dvh;
	}
	header {
		padding: calc(14px + var(--safe-t)) 20px 6px;
		animation: fade 900ms var(--ease) both;
	}
	.brand {
		display: inline-flex;
		align-items: center;
		gap: 10px;
		color: var(--text);
		text-decoration: none;
		min-height: var(--tap);
	}
	.word {
		font-size: 1.25rem;
		font-weight: 650;
		letter-spacing: 0.02em;
	}
	main {
		padding-bottom: calc(var(--nav-h) + 40px + var(--safe-b));
	}
</style>
