<script lang="ts">
	// Simple line icons, drawn in the current text colour.
	type Name =
		| 'today' | 'mic' | 'circle' | 'gear' | 'check' | 'close' | 'back' | 'chevron'
		| 'send' | 'clock' | 'stop' | 'keyboard' | 'threads' | 'share' | 'calendar' | 'download'
		| 'arrow' | 'arrow-out' | 'plus' | 'refresh';
	let { name, size = 24, stroke = 1.6 }: { name: Name; size?: number; stroke?: number } = $props();
</script>

<svg
	width={size}
	height={size}
	viewBox="0 0 24 24"
	fill="none"
	stroke="currentColor"
	stroke-width={stroke}
	stroke-linecap="round"
	stroke-linejoin="round"
	aria-hidden="true"
>
	{#if name === 'today'}
		<circle cx="12" cy="12" r="4" />
		<path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4" />
	{:else if name === 'mic'}
		<rect x="9" y="3" width="6" height="11" rx="3" />
		<path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" />
	{:else if name === 'circle'}
		<circle cx="9" cy="9" r="3.2" />
		<circle cx="16.5" cy="10.5" r="2.5" />
		<path d="M3.5 19c.8-3 3-4.6 5.5-4.6s4.7 1.6 5.5 4.6M14.5 15.2c.6-.3 1.3-.5 2-.5 2 0 3.6 1.3 4 4.3" />
	{:else if name === 'gear'}
		<circle cx="12" cy="12" r="3" />
		<path
			d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"
		/>
	{:else if name === 'check'}
		<path d="M5 12.5 10 17 19 7.5" />
	{:else if name === 'close'}
		<path d="M6 6l12 12M18 6 6 18" />
	{:else if name === 'back'}
		<path d="M15 5l-7 7 7 7" />
	{:else if name === 'chevron'}
		<path d="M9 5l7 7-7 7" />
	{:else if name === 'send'}
		<path d="M4 12 20 4l-5 16-3-7-8-1z" />
	{:else if name === 'clock'}
		<circle cx="12" cy="12" r="8.5" />
		<path d="M12 7.5V12l3 2" />
	{:else if name === 'stop'}
		<rect x="7" y="7" width="10" height="10" rx="2.5" fill="currentColor" stroke="none" />
	{:else if name === 'keyboard'}
		<rect x="2.5" y="6" width="19" height="12" rx="2.5" />
		<path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7.5 14h9" />
	{:else if name === 'threads'}
		<path d="M5 7h14M5 12h10M5 17h7" />
	{:else if name === 'share'}
		<path d="M12 15V3.5M7.5 8 12 3.5 16.5 8M5 12.5V19a1.5 1.5 0 0 0 1.5 1.5h11A1.5 1.5 0 0 0 19 19v-6.5" />
	{:else if name === 'calendar'}
		<rect x="3.5" y="5" width="17" height="15" rx="2.5" />
		<path d="M3.5 10h17M8 3v4M16 3v4" />
	{:else if name === 'arrow'}
		<path d="M5 12h14M13 6l6 6-6 6" />
	{:else if name === 'arrow-out'}
		<path d="M7 17 17 7M9 7h8v8" />
	{:else if name === 'plus'}
		<path d="M12 5v14M5 12h14" />
	{:else if name === 'refresh'}
		<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.5 4.5v4h-4" />
	{:else if name === 'download'}
		<path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19.5h14" />
	{/if}
</svg>

<style>
	svg {
		display: block;
		flex: none;
	}
</style>
