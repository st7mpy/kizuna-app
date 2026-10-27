<script lang="ts">
	// The landing page: what Kizuna is, how it differs, and two ways in.
	// Shown at "/" to a first-time visitor and always at /about. Hides the app's header and tabs.
	import { onDestroy, onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { loadSample, SAMPLES, type SampleKey } from '#lib/core/index.js';
	import { chrome } from '#lib/ui/chrome.svelte.js';
	import Mark from '#lib/ui/Mark.svelte';
	import Icon from '#lib/ui/Icon.svelte';
	import { getTheme, setTheme } from '#lib/ui/theme.js';
	import FamilyTree from './FamilyTree.svelte';
	import HowItWorks from './HowItWorks.svelte';
	import FamilyPhone from './FamilyPhone.svelte';
	import Compare from './Compare.svelte';
	import { reveal } from './reveal.js';
	import { markEntered } from './entered.js';

	/** True when this device already has notes: the sample would replace them, so offer "Open Kizuna". */
	let { returning = false }: { returning?: boolean } = $props();

	const REPO = 'https://github.com/st7mpy/kizuna-app';

	let sampling = $state(false);
	let failed = $state(false);
	let scrolled = $state(false);

	chrome.bare = true;
	onDestroy(() => (chrome.bare = false));

	onMount(() => {
		const onScroll = () => (scrolled = window.scrollY > 8);
		onScroll();
		addEventListener('scroll', onScroll, { passive: true });
		return () => removeEventListener('scroll', onScroll);
	});

	// The first sample is the default; the second is one tap away under the main button.
	let pickedKey = $state<SampleKey>('abroad');
	async function trySample(key: SampleKey = 'abroad') {
		if (sampling) return;
		pickedKey = key;
		sampling = true;
		failed = false;
		try {
			await loadSample(key);
			markEntered();
			await goto('/map');
		} catch {
			failed = true;
		} finally {
			sampling = false;
		}
	}

	function startOwn() {
		markEntered();
		goto('/talk');
	}

	function openApp() {
		markEntered();
		goto('/');
	}

	function flipTheme() {
		const t = getTheme();
		const darkNow = t === 'dark' || (t === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
		setTheme(darkNow ? 'light' : 'dark');
	}
</script>

{#snippet ctas(where: string)}
	<div class="ctas">
		{#if returning}
			<button class="cta primary" type="button" onclick={openApp}>Open Kizuna <Icon name="arrow" size={18} /></button>
			<button class="cta line" type="button" onclick={startOwn}>Talk to Kizuna</button>
		{:else}
			<button class="cta primary" type="button" onclick={() => trySample()} disabled={sampling} data-where={where}>
				{sampling ? 'Setting up the sample family…' : 'Try it with a sample family'}
				{#if !sampling}<Icon name="arrow" size={18} />{/if}
			</button>
			<button class="cta line" type="button" onclick={startOwn}>Start with your own</button>
		{/if}
	</div>
	{#if !returning}
		<p class="samples">
			<span>Pick a sample:</span>
			{#each SAMPLES as s (s.key)}
				<button type="button" onclick={() => trySample(s.key)} disabled={sampling} data-sample={s.key} title={s.blurb}>{s.label}</button>
			{/each}
		</p>
	{/if}
	{#if failed}
		<p class="err" role="status">Couldn’t load the sample just now. Try again in a moment.</p>
	{/if}
{/snippet}

<div class="landing">
	<header class="nav" class:scrolled>
		<div class="in">
			<a class="brand" href="#top" aria-label="Kizuna, back to top"><Mark size={28} --mark-paper="var(--bg)" /><span>Kizuna</span></a>
			<nav aria-label="Sections">
				<a href="#how">How it works</a>
				<a href="#map">The map</a>
				<a href="#compare">Compare</a>
				<a href="#privacy">Privacy</a>
			</nav>
			<div class="right">
				<button class="round" type="button" onclick={flipTheme} aria-label="Switch light or dark">
					<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true">
						<circle cx="12" cy="12" r="8.5" />
						<path d="M12 3.5a8.5 8.5 0 0 1 0 17Z" fill="currentColor" />
					</svg>
				</button>
				{#if returning}
					<button class="cta small" type="button" onclick={openApp}>Open Kizuna</button>
				{:else}
					<button class="cta small" type="button" onclick={() => trySample()} disabled={sampling}>Try the sample</button>
				{/if}
			</div>
		</div>
	</header>

	<main id="top">
		<!-- hero -->
		<section class="hero">
			<div class="sky" aria-hidden="true"><i class="cloud c1"></i><i class="cloud c2"></i><i class="cloud c3"></i></div>
			<div class="in hero-grid">
				<div class="hero-copy">
					<p class="kicker fade" style="--d:80ms"><span>絆</span><span class="sep">·</span><span>the bonds between people</span></p>
					<h1>
						<span class="w" style="--i:0">Know when your people are free to talk.</span>
						<span class="w soft" style="--i:1">Never where they are.</span>
					</h1>
					<p class="lede fade" style="--d:520ms">
						Tell Kizuna what’s on your mind, the way you’d say it to a friend. It remembers the people inside your notes,
						and at a good moment hands you a ready WhatsApp line and a time that works.
					</p>
					<div class="fade" style="--d:680ms">{@render ctas('hero')}</div>
					<p class="fine fade" style="--d:820ms"><span>Works in your browser</span><span>No account</span><span>Nothing for your family to install</span></p>
				</div>
				<div class="hero-art fade" style="--d:300ms">
					<FamilyTree />
				</div>
			</div>
		</section>

		<!-- what it isn't -->
		<section class="band" aria-label="What Kizuna never does">
			<div class="in nots">
				<p use:reveal={0}><span class="x" aria-hidden="true"></span>No location, ever</p>
				<p use:reveal={80}><span class="x" aria-hidden="true"></span>No app for your family</p>
				<p use:reveal={160}><span class="x" aria-hidden="true"></span>No streaks or scores</p>
				<p use:reveal={240}><span class="x" aria-hidden="true"></span>No message sent without you</p>
			</div>
		</section>

		<!-- how it works -->
		<section class="scene" id="how">
			<div class="in">
				<div class="shead" use:reveal>
					<p class="kicker"><span>How it works</span></p>
					<h2>Say it once. Kizuna remembers.</h2>
					<p class="lede">No contacts to type in, no reminders to set. Talk the way you think, half sentences and all, and let Kizuna find the right moment.</p>
				</div>
				<HowItWorks />
			</div>
		</section>

		<!-- the map + family page -->
		<section class="scene tint" id="map">
			<div class="in split">
				<div class="copy">
					<p class="kicker" use:reveal><span>The Kizuna map</span></p>
					<h2 use:reveal={60}>Free, not found.</h2>
					<p class="lede" use:reveal={120}>
						Your people on one calm map: you in the middle, family close, friends further out. Each shows their local time,
						night falling where it’s late, and a soft glow when they’re open to a call.
					</p>
					<ul class="points">
						<li use:reveal={160}><b>Nothing to install.</b> Family answer from a link in WhatsApp: four big buttons, or a voice note.</li>
						<li use:reveal={220}><b>Sealed on their phone.</b> Each answer is locked with a key that only lives in the family link, so the server can’t read it.</li>
						<li use:reveal={280}><b>One plan, or nothing.</b> On Friday evening Kizuna may suggest one weekend call, with a reason and a time everyone is free. If nothing fits, it stays quiet.</li>
					</ul>
				</div>
				<div class="media" use:reveal={100}>
					<FamilyPhone />
				</div>
			</div>
		</section>

		<!-- compare -->
		<section class="scene" id="compare">
			<div class="in">
				<div class="shead" use:reveal>
					<p class="kicker"><span>How it’s different</span></p>
					<h2>Other apps watch, count or wait.</h2>
					<p class="lede">
						Trackers show where people are. Personal CRMs count the days. Group calendars wait for everyone to fill them in.
						Kizuna finds one good moment, hands you the words, and gets out of the way.
					</p>
				</div>
				<div use:reveal={100}><Compare /></div>
				<p class="aside" use:reveal={150}>
					<b>And WhatsApp?</b> It’s where the call happens. Kizuna is the part before it: noticing that Jordan started a new job,
					that Dad’s birthday is next week, and that Jordan is free Saturday morning.
				</p>
			</div>
		</section>

		<!-- privacy -->
		<section class="scene tint" id="privacy">
			<div class="in">
				<div class="shead" use:reveal>
					<p class="kicker"><span>Yours</span></p>
					<h2>Quiet by design.</h2>
				</div>
				<div class="facts">
					<div class="fact" use:reveal={0}>
						<span class="fn">On your phone</span>
						<h3>Notes stay on your phone</h3>
						<p>No account. Notes, people and threads live in your browser. Text is sent only to be understood, and isn’t stored.</p>
					</div>
					<div class="fact" use:reveal={80}>
						<span class="fn">No location</span>
						<h3>No location, ever</h3>
						<p>The map shows local time and the free windows people choose to share. Never where anyone is.</p>
					</div>
					<div class="fact" use:reveal={160}>
						<span class="fn">Sealed</span>
						<h3>Sealed for family</h3>
						<p>Map entries are locked on the device. The server only holds what it can’t read, and it’s gone after 8 days.</p>
					</div>
					<div class="fact" use:reveal={240}>
						<span class="fn">No scores</span>
						<h3>No streaks, no scores</h3>
						<p>No counters, “days since” or red badges. “Not now” is a normal answer, and you send every message yourself.</p>
					</div>
				</div>
			</div>
		</section>

		<!-- built on -->
		<section class="scene" id="built">
			<div class="in">
				<div class="shead" use:reveal>
					<p class="kicker"><span>Built on Meta’s Muse models</span></p>
					<h2>Two models, each doing one job well.</h2>
				</div>
				<div class="models">
					<article use:reveal={0}>
						<p class="mname">Muse Voice Transcribe</p>
						<p>Live words while you speak, half sentences and all. Family can answer with a voice note too.</p>
						<ul class="chips"><li>live, as you talk</li><li>typing works too</li><li>voice replies</li></ul>
					</article>
					<article use:reveal={100}>
						<p class="mname">Muse Spark</p>
						<p>Reads each note into people, dates and promises. Weaves your circle and merges nicknames. Plans the weekend call with tool calls, and drafts the line in your language.</p>
						<ul class="chips"><li>structured output</li><li>long context</li><li>tool calling</li></ul>
					</article>
				</div>
			</div>
		</section>

		<!-- finale -->
		<section class="finale">
			<div class="in">
				<div class="titlecard" use:reveal>
					<div class="word"><Mark size={64} --mark-paper="var(--surface)" /><span>Kizuna</span></div>
					<p class="tagline">Keep your thoughts and your people from slipping away.</p>
					{@render ctas('end')}
				</div>
			</div>
		</section>
	</main>

	<footer>
		<div class="in foot">
			<div class="about">
				<span class="brand"><Mark size={24} --mark-paper="var(--bg)" /><span>Kizuna</span></span>
				<p>Kizuna (絆) is Japanese for the bonds between people.</p>
			</div>
			<div>
				<h4>Kizuna</h4>
				<ul>
					<li><a href="#how">How it works</a></li>
					<li><a href="#map">The map</a></li>
					<li><a href="#compare">Compare</a></li>
					<li><a href="#privacy">Privacy</a></li>
				</ul>
			</div>
			<div>
				<h4>Open it</h4>
				<ul>
					{#if returning}
						<li><button type="button" onclick={openApp}>Open Kizuna</button></li>
					{:else}
						{#each SAMPLES as s (s.key)}<li>
								<button type="button" onclick={() => trySample(s.key)} disabled={sampling} aria-busy={sampling && pickedKey === s.key}
									>{sampling && pickedKey === s.key ? 'Setting up the sample family…' : `Sample: ${s.label}`}</button
								>
							</li>{/each}
						{#if failed}<li class="foot-err" role="status">Couldn’t load the sample just now. Try again in a moment.</li>{/if}
					{/if}
					<li><button type="button" onclick={startOwn}>Start with your own</button></li>
				</ul>
			</div>
			<div>
				<h4>Code</h4>
				<ul>
					<li><a href={REPO} rel="noopener">GitHub</a></li>
					<li><a href="{REPO}/blob/main/LICENSE" rel="noopener">MIT license</a></li>
				</ul>
			</div>
		</div>
		<div class="in base">
			<span>Open source under the MIT license</span>
			<span>Made for the Meta Global AI Developer Hackathon 2026</span>
		</div>
	</footer>
</div>

<style>
	.landing {
		--wrap: 1180px;
		--pad: clamp(16px, 4vw, 40px);
		min-height: 100dvh;
		background: var(--bg);
		overflow-x: clip;
	}
	.in {
		max-width: var(--wrap);
		margin: 0 auto;
		padding-inline: var(--pad);
	}

	/* nav */
	.nav {
		position: sticky;
		top: 0;
		z-index: 20;
		padding-top: var(--safe-t);
		border-bottom: 1px solid transparent;
		transition:
			background 300ms var(--ease),
			border-color 300ms var(--ease);
	}
	.nav.scrolled {
		background: color-mix(in srgb, var(--bg) 78%, transparent);
		backdrop-filter: blur(14px) saturate(1.2);
		-webkit-backdrop-filter: blur(14px) saturate(1.2);
		border-bottom-color: var(--line);
	}
	.nav .in {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 16px;
		height: 72px;
	}
	.brand {
		display: inline-flex;
		align-items: center;
		gap: 10px;
		color: var(--text);
		text-decoration: none;
		font-weight: 600;
		font-size: 1.0625rem;
		letter-spacing: -0.015em;
	}
	.nav nav {
		display: flex;
		gap: 28px;
		font-size: 0.9375rem;
		font-weight: 500;
	}
	.nav nav a {
		color: var(--text-2);
		text-decoration: none;
		transition: color 200ms;
	}
	.nav nav a:hover {
		color: var(--text);
	}
	.right {
		display: flex;
		align-items: center;
		gap: 10px;
	}
	.round {
		display: grid;
		place-items: center;
		width: 38px;
		height: 38px;
		border-radius: 50%;
		border: 0;
		background: transparent;
		color: var(--text);
		box-shadow: inset 0 0 0 1px var(--line-2);
		cursor: pointer;
		transition: background 200ms;
	}
	.round:hover {
		background: color-mix(in srgb, var(--surface) 70%, transparent);
	}
	@media (max-width: 820px) {
		.nav nav {
			display: none;
		}
	}

	/* buttons */
	.ctas {
		display: flex;
		flex-wrap: wrap;
		gap: 12px;
	}
	.cta {
		appearance: none;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 10px;
		min-height: 52px;
		padding: 0 24px;
		border: 0;
		border-radius: 999px;
		font: inherit;
		font-size: 1rem;
		font-weight: 500;
		letter-spacing: -0.005em;
		cursor: pointer;
		white-space: nowrap;
		transition:
			transform 300ms var(--ease),
			box-shadow 300ms var(--ease),
			background 200ms;
	}
	/* Ink pills, as on a printed page; blue stays inside the app for the one main action. */
	.cta.primary {
		background: var(--rule);
		color: var(--on-rule);
	}
	.cta:hover:not(:disabled) {
		transform: translateY(-1px);
		box-shadow: 0 10px 24px -10px color-mix(in srgb, var(--text) 55%, transparent);
	}
	.cta.line {
		background: color-mix(in srgb, var(--surface) 72%, transparent);
		color: var(--text);
		box-shadow: inset 0 0 0 1px var(--line);
		backdrop-filter: blur(8px);
		-webkit-backdrop-filter: blur(8px);
	}
	.cta.line:hover:not(:disabled) {
		background: var(--surface);
		box-shadow: inset 0 0 0 1px var(--line), 0 10px 24px -14px rgb(60 45 20 / 0.3);
	}
	.cta.small {
		min-height: 40px;
		padding: 0 18px;
		font-size: 0.9375rem;
		background: var(--rule);
		color: var(--on-rule);
	}
	.cta:active:not(:disabled) {
		transform: scale(0.98);
	}
	.cta:disabled {
		opacity: 0.7;
		cursor: progress;
	}
	.err {
		margin-top: 12px;
		color: var(--text-2);
		font-size: var(--t-small);
	}
	/* other samples: a tiny tracked label and small glass pills, quieter than the main button */
	.samples {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px;
		margin: 16px 0 0;
	}
	.samples span {
		/* the label on its own line, so the chips never wrap ragged under it */
		flex-basis: 100%;
		margin-right: 4px;
		font-size: var(--t-label);
		font-weight: 500;
		letter-spacing: 0.14em;
		text-transform: uppercase;
		color: var(--text-3);
	}
	.samples button {
		appearance: none;
		min-height: 36px;
		padding: 0 14px;
		border: 0;
		border-radius: 999px;
		background: var(--surface);
		box-shadow: inset 0 0 0 1px var(--line);
		-webkit-backdrop-filter: var(--blur);
		backdrop-filter: var(--blur);
		color: var(--text-2);
		font: inherit;
		font-size: 0.875rem;
		font-weight: 500;
		cursor: pointer;
		transition:
			color 200ms,
			box-shadow 200ms;
	}
	.samples button:hover:not(:disabled) {
		color: var(--text);
		box-shadow: inset 0 0 0 1px var(--line-2);
	}
	.foot-err {
		color: var(--text-2);
		font-size: var(--t-small);
	}
	.samples button:disabled {
		opacity: 0.6;
		cursor: progress;
	}

	/* type */
	.kicker {
		display: inline-flex;
		gap: 0.6em;
		align-items: center;
		font-size: 0.75rem;
		font-weight: 500;
		letter-spacing: 0.16em;
		text-transform: uppercase;
		color: var(--accent-ink);
	}
	.kicker .sep {
		opacity: 0.5;
	}
	h1 {
		font-size: clamp(2.625rem, 5vw, 4.75rem);
		line-height: 1.02;
		letter-spacing: -0.045em;
	}
	h1 .w {
		display: block;
	}
	h1 .soft {
		color: var(--text-3);
		margin-top: 0.18em;
		font-size: 0.62em;
		letter-spacing: -0.04em;
	}
	h2 {
		font-size: clamp(2.125rem, 4vw, 3.5rem);
		line-height: 1.04;
		letter-spacing: -0.04em;
		text-wrap: balance;
	}
	.lede {
		font-size: clamp(1.0625rem, 1.5vw, 1.25rem);
		line-height: 1.5;
		color: var(--text-2);
		max-width: 36em;
		text-wrap: pretty;
	}

	/* hero: a soft time-of-day sky that fades into the paper, with slow drifting light */
	.hero {
		position: relative;
		isolation: isolate;
		margin-top: calc(-72px - var(--safe-t));
		padding-block: calc(72px + var(--safe-t) + clamp(28px, 5vw, 72px)) clamp(64px, 8vw, 112px);
	}
	.sky {
		position: absolute;
		inset: 0;
		z-index: -1;
		overflow: hidden;
		pointer-events: none;
		background: var(--sky);
	}
	.sky::after {
		content: '';
		position: absolute;
		inset: auto 0 0;
		height: 36%;
		background: linear-gradient(180deg, transparent, var(--bg));
	}
	.cloud {
		position: absolute;
		border-radius: 50%;
		filter: blur(48px);
		opacity: 0.7;
		animation: drift 46s ease-in-out infinite alternate;
	}
	.c1 {
		width: 46vw;
		height: 22vw;
		left: -8vw;
		top: 6%;
		background: color-mix(in srgb, #ffffff 70%, transparent);
	}
	.c2 {
		width: 38vw;
		height: 20vw;
		right: -6vw;
		top: 18%;
		background: color-mix(in srgb, var(--dawn-lilac) 55%, transparent);
		animation-duration: 58s;
		animation-direction: alternate-reverse;
	}
	.c3 {
		width: 40vw;
		height: 16vw;
		left: 30vw;
		top: 52%;
		background: color-mix(in srgb, var(--dawn-peach) 50%, transparent);
		animation-duration: 64s;
	}
	:global(:root[data-theme='dark']) .c1 {
		background: color-mix(in srgb, #8fa6d6 18%, transparent);
	}
	@media (prefers-color-scheme: dark) {
		:global(:root:not([data-theme='light'])) .c1 {
			background: color-mix(in srgb, #8fa6d6 18%, transparent);
		}
	}
	@keyframes drift {
		from {
			transform: translate3d(-3vw, 0, 0) scale(1);
		}
		to {
			transform: translate3d(4vw, 1.5vw, 0) scale(1.08);
		}
	}
	.hero-grid {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(0, 1.05fr);
		gap: clamp(32px, 5vw, 72px);
		align-items: center;
	}
	.hero-copy {
		display: flex;
		flex-direction: column;
		gap: 26px;
	}
	.fine {
		display: flex;
		flex-wrap: wrap;
		gap: 2px 8px;
		font-size: 0.8125rem;
		color: var(--text-3);
		margin-top: -8px;
	}
	.fine span {
		white-space: nowrap;
	}
	.fine span + span::before {
		content: '·';
		margin-right: 8px;
		opacity: 0.6;
	}
	.hero-art {
		position: relative;
	}
	@keyframes float {
		50% {
			transform: translateY(-8px);
		}
	}
	/* hero entrance */
	h1 .w {
		opacity: 0;
		filter: blur(8px);
		transform: translateY(0.2em);
		animation: rise 1s var(--ease) forwards;
		animation-delay: calc(120ms + var(--i) * 180ms);
	}
	.fade {
		opacity: 0;
		transform: translateY(12px);
		animation: rise 900ms var(--ease) forwards;
		animation-delay: var(--d, 0ms);
	}
	@keyframes rise {
		to {
			opacity: 1;
			filter: none;
			transform: none;
		}
	}
	@media (max-width: 900px) {
		.hero-grid {
			grid-template-columns: minmax(0, 1fr);
		}
		.hero-art {
			max-width: 560px;
			width: 100%;
			margin: 8px auto 0;
		}
	}

	/* the band of nevers: four quiet promises, no rules */
	.nots {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: 12px 40px;
		padding-block: 8px 24px;
	}
	.nots p {
		display: inline-flex;
		align-items: center;
		gap: 10px;
		font-size: 0.9375rem;
		font-weight: 500;
		color: var(--text-2);
		letter-spacing: -0.005em;
	}
	/* a small struck circle: "never" */
	.x {
		position: relative;
		flex: none;
		width: 14px;
		height: 14px;
		border-radius: 50%;
		box-shadow: inset 0 0 0 1.5px var(--text-3);
	}
	.x::after {
		content: '';
		position: absolute;
		left: 50%;
		top: 1px;
		bottom: 1px;
		width: 1.5px;
		background: var(--text-3);
		transform: translateX(-50%) rotate(45deg);
	}
	@media (max-width: 560px) {
		.nots {
			display: grid;
			grid-template-columns: 1fr 1fr;
			gap: 14px 16px;
			justify-items: start;
		}
		.nots p {
			font-size: 0.875rem;
			align-items: flex-start;
		}
		.x {
			margin-top: 2px;
		}
	}

	/* scenes */
	.scene {
		padding-block: clamp(72px, 10vw, 136px);
	}
	.tint {
		background: var(--bg-2);
	}
	.shead {
		display: grid;
		gap: 18px;
		max-width: 780px;
		margin-bottom: clamp(40px, 5vw, 64px);
	}
	.split {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
		gap: clamp(36px, 6vw, 96px);
		align-items: center;
	}
	.copy {
		display: grid;
		gap: 18px;
	}
	.points {
		list-style: none;
		margin: 14px 0 0;
		padding: 0;
		display: grid;
		gap: 16px;
	}
	.points li {
		position: relative;
		padding-left: 22px;
		color: var(--text-2);
		max-width: 36em;
	}
	.points li::before {
		content: '';
		position: absolute;
		left: 2px;
		top: 0.62em;
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: var(--accent);
	}
	.points b {
		color: var(--text);
		font-weight: 500;
	}
	@media (max-width: 900px) {
		.split {
			grid-template-columns: minmax(0, 1fr);
		}
	}
	.aside {
		margin-top: 36px;
		padding: 20px 24px;
		border-radius: 18px;
		background: var(--bg-2);
		color: var(--text-2);
		max-width: 44em;
	}
	.aside b {
		color: var(--text);
		font-weight: 500;
	}

	/* privacy facts */
	.facts {
		display: grid;
		grid-template-columns: repeat(4, minmax(0, 1fr));
		gap: 1px;
		background: var(--line);
		border-radius: var(--r-card);
		overflow: hidden;
		box-shadow: 0 0 0 1px var(--line);
	}
	.fact {
		display: grid;
		align-content: start;
		gap: 10px;
		padding: 26px 24px 30px;
		background: var(--bg-2);
	}
	.fn {
		font-size: 0.6875rem;
		font-weight: 500;
		letter-spacing: 0.16em;
		text-transform: uppercase;
		color: var(--text-3);
		margin-bottom: 6px;
	}
	.fact h3 {
		font-size: 1.1875rem;
		font-weight: 500;
		letter-spacing: -0.02em;
		text-transform: none;
		color: var(--text);
		line-height: 1.25;
	}
	.fact p {
		font-size: var(--t-small);
		color: var(--text-2);
	}
	@media (max-width: 960px) {
		.facts {
			grid-template-columns: 1fr 1fr;
		}
	}
	@media (max-width: 560px) {
		.facts {
			grid-template-columns: minmax(0, 1fr);
		}
	}

	/* models */
	.models {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: clamp(16px, 2vw, 24px);
	}
	.models article {
		display: grid;
		align-content: start;
		gap: 14px;
		padding: clamp(24px, 3vw, 36px);
		border-radius: var(--r-card);
		background: var(--surface);
		box-shadow: var(--card-shadow);
		transition:
			transform 500ms var(--ease-out),
			box-shadow 500ms var(--ease-out);
	}
	.models article:hover {
		transform: translateY(-6px);
		box-shadow: var(--card-shadow), var(--shadow);
	}
	.mname {
		font-size: clamp(1.5rem, 2.4vw, 2rem);
		font-weight: 500;
		letter-spacing: -0.03em;
		line-height: 1.1;
	}
	.models p:not(.mname) {
		color: var(--text-2);
		max-width: 40em;
	}
	.chips {
		list-style: none;
		margin: 6px 0 0;
		padding: 0;
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
	}
	.chips li {
		padding: 6px 12px;
		border-radius: 999px;
		background: var(--bg-2);
		font-size: 0.8125rem;
		font-weight: 500;
		color: var(--text-2);
	}
	@media (max-width: 760px) {
		.models {
			grid-template-columns: minmax(0, 1fr);
		}
	}

	/* finale */
	.finale {
		padding-block: 0 clamp(72px, 9vw, 120px);
	}
	.titlecard {
		position: relative;
		overflow: hidden;
		isolation: isolate;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 26px;
		text-align: center;
		padding: clamp(56px, 8vw, 110px) var(--pad);
		border-radius: clamp(24px, 3vw, 36px);
		background: var(--surface);
		box-shadow: var(--shadow);
	}
	.titlecard::before {
		content: '';
		position: absolute;
		inset: 0;
		z-index: -1;
		background: var(--sky);
		opacity: 0.85;
	}
	.titlecard::after {
		content: '';
		position: absolute;
		inset: 0;
		z-index: -1;
		background-image: var(--grain);
		background-size: 180px;
		opacity: 0.12;
		mix-blend-mode: multiply;
	}
	.word {
		display: inline-flex;
		align-items: center;
		gap: clamp(12px, 2vw, 22px);
		font-size: clamp(3rem, 8vw, 6.5rem);
		font-weight: 500;
		letter-spacing: -0.05em;
		line-height: 1;
	}
	.word :global(svg) {
		width: clamp(52px, 8vw, 96px);
		height: auto;
	}
	.titlecard .tagline {
		font-size: clamp(1.125rem, 2vw, 1.5rem);
		color: var(--text-2);
		letter-spacing: -0.02em;
		max-width: 26em;
	}
	.titlecard .ctas {
		justify-content: center;
	}

	/* footer */
	footer {
		border-top: 1px solid var(--line);
		padding-block: 56px calc(36px + var(--safe-b));
		font-size: var(--t-small);
	}
	.foot {
		display: grid;
		grid-template-columns: minmax(0, 1.6fr) repeat(3, minmax(0, 1fr));
		gap: 32px;
	}
	.foot .about p {
		margin-top: 14px;
		color: var(--text-2);
		max-width: 26em;
	}
	h4 {
		margin: 0 0 14px;
		font-size: var(--t-label);
		font-weight: 500;
		letter-spacing: 0.16em;
		text-transform: uppercase;
		color: var(--text-3);
	}
	.foot ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 10px;
	}
	.foot a,
	.foot button {
		appearance: none;
		padding: 0;
		border: 0;
		background: none;
		font: inherit;
		color: var(--text-2);
		text-decoration: none;
		cursor: pointer;
		text-align: left;
	}
	.foot a:hover,
	.foot button:hover {
		color: var(--text);
	}
	.base {
		display: flex;
		justify-content: space-between;
		flex-wrap: wrap;
		gap: 12px;
		margin-top: 48px;
		padding-top: 22px;
		color: var(--text-3);
		font-size: 0.8125rem;
		position: relative;
	}
	.base::before {
		content: '';
		position: absolute;
		top: 0;
		left: var(--pad);
		right: var(--pad);
		border-top: 1px solid var(--line);
	}
	@media (max-width: 760px) {
		.foot {
			grid-template-columns: 1fr 1fr;
		}
		.foot .about {
			grid-column: 1 / -1;
		}
	}

	/* scroll reveal (class added by the reveal action) */
	.landing :global(.rv) {
		opacity: 0;
		transform: translateY(24px);
		filter: blur(5px);
		transition:
			opacity 900ms var(--ease),
			transform 1000ms var(--ease),
			filter 900ms var(--ease);
		transition-delay: var(--d, 0ms);
	}
	.landing :global(.rv.shown) {
		opacity: 1;
		transform: none;
		filter: none;
	}

	@media (max-width: 560px) {
		.fine {
			gap: 4px 14px;
		}
		.fine span + span::before {
			content: none;
		}
		.ctas {
			flex-direction: column;
		}
		.cta {
			width: 100%;
		}
		.nav .cta.small {
			width: auto;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		h1 .w,
		.fade {
			opacity: 1;
			filter: none;
			transform: none;
			animation: none;
		}
		.cloud {
			animation: none;
		}
	}
</style>
