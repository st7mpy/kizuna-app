<script lang="ts">
	// Numbered places on the left, Talk on the right under the thumb.
	// Add a place here (e.g. a map) and the bar makes room for it.
	import { page } from '$app/state';
	import Icon from './Icon.svelte';

	const PLACES: { href: string; label: string; match: (p: string) => boolean }[] = [
		{
			href: '/',
			label: 'Today',
			match: (p) => p === '/' || p.startsWith('/threads') || p.startsWith('/settings')
		},
		{ href: '/circle', label: 'Circle', match: (p) => p.startsWith('/circle') },
		{ href: '/map', label: 'Map', match: (p) => p.startsWith('/map') }
	];

	const path = $derived(page.url.pathname);
	const talking = $derived(path.startsWith('/talk'));
</script>

<nav aria-label="Main">
	<ul>
		{#each PLACES as place, i (place.href)}
			<li>
				<a href={place.href} class="tab" aria-current={place.match(path) ? 'page' : undefined}>
					<span class="n num" aria-hidden="true">{String(i + 1).padStart(2, '0')}</span>
					<span class="t">{place.label}</span>
				</a>
			</li>
		{/each}
	</ul>
	<a href="/talk" class="talk" aria-current={talking ? 'page' : undefined}>
		<span class="t">Talk</span>
		<span class="disc" aria-hidden="true"><Icon name="mic" size={24} stroke={1.8} /></span>
	</a>
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
	.n {
		font-size: 0.6875rem;
		font-weight: 500;
		line-height: 1;
		letter-spacing: 0.02em;
		color: var(--text-3);
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
		bottom: 8px;
		width: 18px;
		height: 2px;
		background: var(--text);
		transform: scaleX(0);
		transform-origin: left;
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
</style>
