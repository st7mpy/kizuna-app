<script lang="ts">
	// Three places: Today, Talk (centre), Circle.
	import { page } from '$app/state';
	import Icon from './Icon.svelte';

	const path = $derived(page.url.pathname);
	const at = $derived({
		today: path === '/' || path.startsWith('/threads') || path.startsWith('/settings'),
		talk: path.startsWith('/talk'),
		circle: path.startsWith('/circle')
	});
</script>

<nav aria-label="Main">
	<a href="/" class="tab" aria-current={at.today ? 'page' : undefined}>
		<Icon name="today" />
		<span>Today</span>
	</a>
	<a href="/talk" class="talk" aria-current={at.talk ? 'page' : undefined} aria-label="Talk">
		<span class="disc"><Icon name="mic" size={28} /></span>
		<span class="lbl">Talk</span>
	</a>
	<a href="/circle" class="tab" aria-current={at.circle ? 'page' : undefined}>
		<Icon name="circle" />
		<span>Circle</span>
	</a>
</nav>

<style>
	nav {
		position: fixed;
		left: 0;
		right: 0;
		bottom: 0;
		z-index: 10;
		display: grid;
		grid-template-columns: 1fr auto 1fr;
		align-items: end;
		max-width: 560px;
		margin: 0 auto;
		padding: 6px 28px calc(8px + var(--safe-b));
		background: color-mix(in srgb, var(--bg) 88%, transparent);
		backdrop-filter: blur(14px);
		-webkit-backdrop-filter: blur(14px);
		border-top: 1px solid var(--line);
	}
	a {
		color: var(--text-3);
		text-decoration: none;
		font-size: 0.8125rem;
		font-weight: 600;
		letter-spacing: 0.01em;
	}
	.tab {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 2px;
		min-height: 56px;
		border-radius: 16px;
		transition: color var(--dur) var(--ease);
	}
	.tab[aria-current='page'] {
		color: var(--accent-ink);
	}
	.talk {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 2px;
		margin-top: -26px;
		border-radius: 999px;
	}
	.disc {
		display: grid;
		place-items: center;
		width: 68px;
		height: 68px;
		border-radius: 50%;
		background: var(--accent);
		color: var(--on-accent);
		box-shadow:
			0 0 0 6px var(--bg),
			0 10px 24px -8px color-mix(in srgb, var(--accent) 70%, transparent);
		transition: transform 180ms var(--ease);
	}
	.talk:active .disc {
		transform: scale(0.94);
	}
	.talk[aria-current='page'] .lbl {
		color: var(--accent-ink);
	}
	.lbl {
		padding-bottom: 6px;
		color: var(--text-2);
	}
</style>
