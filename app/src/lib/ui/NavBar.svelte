<script lang="ts">
	// Places on the left, Talk on the right under the thumb.
	// From 720 px wide the same bar stands up as a left rail: brand, places, Talk, Settings.
	import { page } from '$app/state';
	import Icon from './Icon.svelte';
	import Mark from './Mark.svelte';
	import { screen } from './screen.svelte.js';

	const PLACES: { href: string; label: string; match: (p: string) => boolean }[] = [
		{
			href: '/',
			label: 'Today',
			// On a phone Settings lives under Today; the rail gives it its own place.
			match: (p) => p === '/' || p.startsWith('/threads') || (!screen.rail && p.startsWith('/settings'))
		},
		{ href: '/circle', label: 'Circle', match: (p) => p.startsWith('/circle') },
		{ href: '/map', label: 'Map', match: (p) => p.startsWith('/map') }
	];

	const path = $derived(page.url.pathname);
	const talking = $derived(path.startsWith('/talk'));
</script>

<nav aria-label="Main">
	<a href="/" class="brand rail-only" aria-label="Kizuna, Today">
		<Mark size={26} />
		<span class="word">Kizuna</span>
	</a>
	<ul>
		{#each PLACES as place (place.href)}
			<li>
				<a href={place.href} class="tab" aria-current={place.match(path) ? 'page' : undefined}>
					<span class="t">{place.label}</span>
				</a>
			</li>
		{/each}
	</ul>
	<a href="/talk" class="talk" aria-current={talking ? 'page' : undefined}>
		<span class="t">Talk</span>
		<span class="disc" aria-hidden="true"><Icon name="mic" size={24} stroke={1.8} /></span>
	</a>
	{#if screen.rail}
		<div class="foot">
			<a
				href="/settings"
				class="side"
				aria-label="Settings"
				aria-current={path.startsWith('/settings') ? 'page' : undefined}
			>
				<Icon name="gear" size={20} /> <span>Settings</span>
			</a>
			<a href="/about" class="side small">About Kizuna</a>
		</div>
	{/if}
</nav>

<style>
	nav {
		position: fixed;
		left: 0;
		right: 0;
		bottom: 0;
		z-index: 10;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
		max-width: 560px;
		margin: 0 auto;
		padding: 8px 12px calc(10px + var(--safe-b)) 8px;
		background: color-mix(in srgb, var(--bg) 86%, transparent);
		backdrop-filter: blur(16px) saturate(1.2);
		-webkit-backdrop-filter: blur(16px) saturate(1.2);
		border-top: 1px solid var(--line);
	}
	ul {
		display: flex;
		gap: 2px;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	a {
		color: var(--text-2);
		text-decoration: none;
	}
	.tab {
		position: relative;
		display: flex;
		flex-direction: column;
		justify-content: center;
		min-width: 64px;
		min-height: 56px;
		padding: 0 10px;
		border-radius: 12px;
		transition: color var(--dur) var(--ease);
	}
	.t {
		font-size: 1rem;
		font-weight: 500;
		letter-spacing: -0.01em;
		line-height: 1.5;
	}
	.tab::after {
		content: '';
		position: absolute;
		left: 10px;
		bottom: 10px;
		width: 5px;
		height: 5px;
		border-radius: 50%;
		background: var(--accent);
		transform: scale(0);
		transition: transform var(--dur) var(--ease);
	}
	.tab[aria-current='page'] {
		color: var(--text);
	}
	.tab[aria-current='page']::after {
		transform: none;
	}
	.talk {
		display: flex;
		align-items: center;
		gap: 12px;
		min-height: 56px;
		padding-left: 14px;
		border-radius: 999px;
		color: var(--text);
	}
	.talk .t {
		font-weight: 500;
	}
	.disc {
		position: relative;
		display: grid;
		place-items: center;
		width: 56px;
		height: 56px;
		border-radius: 50%;
		background: var(--accent);
		color: var(--on-accent);
		transition: transform 180ms var(--ease);
	}
	.talk:active .disc {
		transform: scale(0.94);
	}
	.talk[aria-current='page'] .disc::after {
		content: '';
		position: absolute;
		inset: -5px;
		border-radius: 50%;
		box-shadow: 0 0 0 1px var(--accent);
	}
	.talk:focus-visible {
		outline-offset: 2px;
	}
	.rail-only {
		display: none;
	}

	/* ---------- the rail ---------- */
	@media (min-width: 720px) {
		nav {
			top: 0;
			right: auto;
			width: var(--rail-w);
			max-width: none;
			flex-direction: column;
			align-items: stretch;
			justify-content: flex-start;
			gap: 0;
			padding: calc(22px + var(--safe-t)) 14px 20px;
			border-top: 0;
			border-right: 1px solid var(--line);
			background: var(--bg-2);
			backdrop-filter: none;
			-webkit-backdrop-filter: none;
			overflow-y: auto;
		}
		.rail-only {
			display: inline-flex;
		}
		.brand {
			align-items: center;
			gap: 10px;
			min-height: var(--tap);
			padding: 0 10px;
			margin-bottom: 28px;
			color: var(--text);
		}
		.word {
			font-size: 1.0625rem;
			font-weight: 600;
			letter-spacing: -0.015em;
		}
		ul {
			flex-direction: column;
			gap: 4px;
		}
		.tab {
			flex-direction: row;
			align-items: baseline;
			justify-content: flex-start;
			gap: 14px;
			min-height: 44px;
			padding: 9px 14px;
		}
		.tab .t {
			font-size: 1.0625rem;
			line-height: 1.4;
		}
		.tab::after {
			display: none;
		}
		.tab:hover {
			color: var(--text);
		}
		.tab[aria-current='page'] {
			background: var(--surface);
			box-shadow: var(--card-shadow);
		}
		.talk {
			justify-content: space-between;
			margin-top: 22px;
			padding: 6px 6px 6px 20px;
			background: var(--accent);
			color: var(--on-accent);
			box-shadow: 0 8px 18px -12px color-mix(in srgb, var(--accent) 70%, transparent);
			transition: transform 160ms var(--ease);
		}
		.talk .t {
			font-size: 1.0625rem;
		}
		.talk:active {
			transform: scale(0.98);
		}
		.disc {
			width: 44px;
			height: 44px;
			background: color-mix(in srgb, var(--on-accent) 18%, transparent);
		}
		.talk[aria-current='page'] .disc::after {
			inset: -3px;
			box-shadow: 0 0 0 1px var(--on-accent);
		}
		.foot {
			margin-top: auto;
			padding-top: 24px;
			display: flex;
			flex-direction: column;
			gap: 2px;
		}
		.side {
			display: flex;
			align-items: center;
			gap: 10px;
			min-height: 44px;
			padding: 0 12px;
			border-radius: 12px;
			color: var(--text-2);
			font-size: var(--t-small);
			font-weight: 500;
		}
		.side.small {
			color: var(--text-3);
			font-size: 0.8125rem;
			min-height: 36px;
		}
		.side:hover {
			color: var(--text);
		}
		.side[aria-current='page'] {
			background: var(--surface);
			box-shadow: var(--card-shadow);
			color: var(--text);
		}
	}
</style>
