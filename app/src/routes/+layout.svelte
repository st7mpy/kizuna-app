<script lang="ts">
	import '../app.css';
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { startCore } from '#lib/core/index.js';
	import Mark from '#lib/ui/Mark.svelte';
	import NavBar from '#lib/ui/NavBar.svelte';
	import Icon from '#lib/ui/Icon.svelte';
	import Sky from '#lib/ui/Sky.svelte';
	import Toast from '#lib/ui/Toast.svelte';
	import { chrome } from '#lib/ui/chrome.svelte.js';
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

<div class="shell" class:bare={chrome.bare}>
	<a class="skip" href="#main">Skip to content</a>
	{#if !chrome.bare}
		<Sky />
		<header>
			<a href="/" class="brand" aria-label="Kizuna, Today">
				<Mark size={24} />
				<span class="word">Kizuna</span>
			</a>
			<div class="row end">
				<a href="/about" class="about">About</a>
				<a
					href="/settings"
					class="icon-btn bare"
					aria-label="Settings"
					aria-current={page.url.pathname.startsWith('/settings') ? 'page' : undefined}
				>
					<Icon name="gear" size={22} />
				</a>
			</div>
		</header>
	{/if}
	<!-- Before main, so the rail comes first when moving with the keyboard (it is fixed, so it looks the same). -->
	{#if !chrome.bare}<NavBar />{/if}
	<main id="main" tabindex="-1">
		{#key page.url.pathname}
			{@render children()}
		{/key}
	</main>
	<Toast />
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
		animation: fade 900ms var(--ease) backwards;
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
	.end {
		gap: 2px;
	}
	.about {
		display: inline-flex;
		align-items: center;
		min-height: 44px;
		padding: 0 10px;
		color: var(--text-2);
		font-size: var(--t-small);
		font-weight: 500;
		text-decoration: none;
	}
	.skip {
		position: fixed;
		top: 8px;
		left: 8px;
		z-index: 100;
		padding: 10px 16px;
		border-radius: 999px;
		background: var(--surface-solid);
		color: var(--text);
		font-weight: 500;
		text-decoration: none;
		box-shadow: var(--card-shadow);
		transform: translateY(-200%);
	}
	.skip:focus-visible {
		transform: none;
	}
	main:focus {
		outline: none;
	}
	main {
		padding-bottom: calc(var(--nav-h) + 32px + var(--safe-b));
	}
	/* The landing page: no header, no tab bar, full width. */
	.shell.bare {
		max-width: none;
	}
	.shell.bare main {
		padding-bottom: 0;
	}

	/* From 720 px the tab bar becomes a left rail and the content takes the rest. */
	@media (min-width: 720px) {
		.shell:not(.bare) {
			max-width: none;
			padding-left: var(--rail-w);
		}
		.shell:not(.bare) header {
			display: none;
		}
		.shell:not(.bare) main {
			padding-bottom: 0;
		}
	}
</style>
