<script lang="ts">
	import '../app.css';
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { startCore } from '#lib/core/index.js';
	import Mark from '#lib/ui/Mark.svelte';
	import NavBar from '#lib/ui/NavBar.svelte';
	import Icon from '#lib/ui/Icon.svelte';
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
			<Mark size={24} />
			<span class="word">Kizuna</span>
		</a>
		<a
			href="/settings"
			class="icon-btn bare"
			aria-label="Settings"
			aria-current={page.url.pathname.startsWith('/settings') ? 'page' : undefined}
		>
			<Icon name="gear" size={22} />
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
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: calc(8px + var(--safe-t)) 10px 0 var(--gutter);
		animation: fade 900ms var(--ease) both;
	}
	.brand {
		display: inline-flex;
		align-items: center;
		gap: 9px;
		color: var(--text);
		text-decoration: none;
		min-height: var(--tap);
	}
	.word {
		font-size: 1rem;
		font-weight: 600;
		letter-spacing: -0.015em;
	}
	header .icon-btn[aria-current='page'] {
		color: var(--text);
		box-shadow: inset 0 0 0 1px var(--line);
	}
	main {
		padding-bottom: calc(var(--nav-h) + 32px + var(--safe-b));
	}
</style>
