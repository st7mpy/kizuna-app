<script lang="ts">
	// The landing page: what Kizuna is, how it differs, and two ways in.
	// Shown at "/" to a first-time visitor and always at /about. Hides the app's header and tabs.
	import { onDestroy, onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { loadSampleLife } from '#lib/core/index.js';
	import { chrome } from '#lib/ui/chrome.svelte.js';
	import Mark from '#lib/ui/Mark.svelte';
	import Icon from '#lib/ui/Icon.svelte';
	import { getTheme, setTheme } from '#lib/ui/theme.js';
	import HeroMap from './HeroMap.svelte';
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

	async function trySample() {
		if (sampling) return;
		sampling = true;
		failed = false;
		try {
			await loadSampleLife();
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
			<button class="cta primary" type="button" onclick={trySample} disabled={sampling} data-where={where}>
				{sampling ? 'Setting up the sample family…' : 'Try it with a sample family'}
				{#if !sampling}<Icon name="arrow" size={18} />{/if}
			</button>
			<button class="cta line" type="button" onclick={startOwn}>Start with your own</button>
		{/if}
	</div>
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
					<button class="cta small" type="button" onclick={trySample} disabled={sampling}>Try the sample</button>
				{/if}
			</div>
		</div>
	</header>

	<main id="top">
		<!-- hero -->
		<section class="hero">
			<div class="glow" aria-hidden="true"></div>
			<div class="in hero-grid">
				<div class="hero-copy">
					<p class="kicker fade" style="--d:80ms"><span>絆</span><span class="sep">·</span><span>the bonds between people</span></p>
					<h1>
						<span class="w" style="--i:0">Know when your people are free to <em>talk</em>.</span>
						<span class="w soft" style="--i:1">Never where they are.</span>
					</h1>
					<p class="lede fade" style="--d:520ms">
						Tell Kizuna what’s on your mind, in English, Hindi or both. It remembers the people inside your notes,
						and at a good moment hands you a ready WhatsApp line and a time that works.
					</p>
					<div class="fade" style="--d:680ms">{@render ctas('hero')}</div>
					<p class="fine fade" style="--d:820ms"><span>Works in your browser</span><span>No account</span><span>Nothing for your family to install</span></p>
				</div>
				<div class="hero-art fade" style="--d:300ms">
					<HeroMap />
					<div class="plan-card">
						<span class="lbl">This weekend</span>
						<p class="big num">Sunday 10:00</p>
						<p><i style="--hue:#9cc6ee"></i><em>Mum</em> and <i style="--hue:#f4c46c"></i><em>Nani</em> are free. It’s Diwali that day.</p>
					</div>
				</div>
			</div>
		</section>

		<!-- what it isn't -->
		<section class="band" aria-label="What Kizuna never does">
			<div class="in nots">
				<p use:reveal={0}><span class="x">No</span> location, ever</p>
				<p use:reveal={80}><span class="x">No</span> app for your family</p>
				<p use:reveal={160}><span class="x">No</span> streaks or scores</p>
				<p use:reveal={240}><span class="x">No</span> message sent without you</p>
			</div>
		</section>

		<!-- how it works -->
		<section class="scene" id="how">
			<div class="in">
				<div class="shead" use:reveal>
					<p class="kicker"><span>How it works</span></p>
					<h2>Say it once. Kizuna <em>remembers</em>.</h2>
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
					<h2 use:reveal={60}>Free, not <em>found</em>.</h2>
					<p class="lede" use:reveal={120}>
						Your people on one calm map: you in the middle, family close, friends further out. Each shows their local time,
						night falling where it’s late, and a soft glow when they’re open to a call.
					</p>
					<ul class="points">
						<li use:reveal={160}><b>Nothing to install.</b> Family answer from a link in WhatsApp: four big buttons in English and Hindi, or a voice note.</li>
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
					<h2>Other apps watch, count or <em>wait</em>.</h2>
					<p class="lede">
						Trackers show where people are. Personal CRMs count the days. Group calendars wait for everyone to fill them in.
						Kizuna finds one good moment, hands you the words, and gets out of the way.
					</p>
				</div>
				<div use:reveal={100}><Compare /></div>
				<p class="aside" use:reveal={150}>
					<b>And WhatsApp?</b> It’s where the call happens. Kizuna is the part before it: noticing that Kabir started a new job,
					that Diwali is on Sunday, and that he’s free Saturday evening.
				</p>
			</div>
		</section>

		<!-- privacy -->
		<section class="scene tint" id="privacy">
			<div class="in">
				<div class="shead" use:reveal>
					<p class="kicker"><span>Yours</span></p>
					<h2>Quiet by <em>design</em>.</h2>
				</div>
				<div class="facts">
					<div class="fact" use:reveal={0}>
						<span class="fn num">01</span>
						<h3>Notes stay on your phone</h3>
						<p>No account. Notes, people and threads live in your browser. Text is sent only to be understood, and isn’t stored.</p>
					</div>
					<div class="fact" use:reveal={80}>
						<span class="fn num">02</span>
						<h3>No location, ever</h3>
						<p>The map shows local time and the free windows people choose to share. Never where anyone is.</p>
					</div>
					<div class="fact" use:reveal={160}>
						<span class="fn num">03</span>
						<h3>Sealed for family</h3>
						<p>Map entries are locked on the device. The server only holds what it can’t read, and it’s gone after 8 days.</p>
					</div>
					<div class="fact" use:reveal={240}>
						<span class="fn num">04</span>
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
					<h2>Two models, each doing <em>one</em> job well.</h2>
				</div>
				<div class="models">
					<article use:reveal={0}>
						<p class="mname">Muse Voice Transcribe</p>
						<p>Live words while you speak, in English, Hindi or both, switching mid-sentence. Family can answer with a voice note too.</p>
						<ul class="chips"><li>live, as you talk</li><li>Hindi + English</li><li>voice replies</li></ul>
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
				<div class="card" use:reveal>
					<div class="word"><Mark size={64} --mark-paper="var(--surface)" /><span>Kizuna</span></div>
					<p class="tagline">Keep your thoughts and your <em>people</em> from slipping away.</p>
					{@render ctas('end')}
				</div>
			</div>
		</section>
	</main>

	<footer>
		<div class="in foot">
			<div class="about">
				<span class="brand"><Mark size={24} --mark-paper="var(--bg)" /><span>Kizuna</span></span>
				<p><em>Kizuna</em> (絆) is Japanese for the bonds between people.</p>
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
						<li><button type="button" onclick={trySample}>Try the sample family</button></li>
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
		background: color-mix(in srgb, var(--bg) 80%, transparent);
		backdrop-filter: blur(14px) saturate(1.2);
		-webkit-backdrop-filter: blur(14px) saturate(1.2);
		border-bottom-color: var(--line);
	}
	.nav .in {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 16px;
		height: 68px;
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
		width: 40px;
		height: 40px;
		border-radius: 50%;
		border: 0;
		background: transparent;
		color: var(--text);
		box-shadow: inset 0 0 0 1px var(--line);
		cursor: pointer;
	}
	.round:hover {
		background: var(--accent-soft);
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
		min-height: 54px;
		padding: 0 26px;
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
	.cta.primary {
		background: var(--accent);
		color: var(--on-accent);
	}
	.cta.primary:hover:not(:disabled) {
		transform: translateY(-1px);
		box-shadow: 0 14px 28px -14px color-mix(in srgb, var(--accent) 80%, transparent);
	}
	.cta.line {
		background: transparent;
		color: var(--text);
		box-shadow: inset 0 0 0 1px var(--line);
	}
	.cta.line:hover {
		background: var(--accent-soft);
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

	/* type */
	.kicker {
		display: inline-flex;
		gap: 0.6em;
		align-items: center;
		font-size: var(--t-label);
		font-weight: 500;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--accent-ink);
	}
	.kicker .sep {
		opacity: 0.5;
	}
	h1 {
		font-size: clamp(2.5rem, 4.3vw, 4rem);
		line-height: 1;
		letter-spacing: -0.045em;
	}
	h1 .w {
		display: block;
	}
	h1 .soft {
		color: var(--text-3);
		margin-top: 0.22em;
		font-size: 0.68em;
		letter-spacing: -0.035em;
	}
	h2 {
		font-size: clamp(2.125rem, 4vw, 3.5rem);
		line-height: 1.04;
		letter-spacing: -0.04em;
		text-wrap: balance;
	}
	h2 em {
		font-size: 1.08em;
		letter-spacing: -0.01em;
	}
	.lede {
		font-size: clamp(1.0625rem, 1.5vw, 1.25rem);
		line-height: 1.5;
		color: var(--text-2);
		max-width: 36em;
		text-wrap: pretty;
	}

	/* hero */
	.hero {
		position: relative;
		isolation: isolate;
		padding-block: clamp(28px, 5vw, 64px) clamp(56px, 7vw, 96px);
	}
	.glow {
		position: absolute;
		inset: -120px 0 0;
		z-index: -1;
		pointer-events: none;
		background:
			radial-gradient(520px 380px at 74% 34%, color-mix(in srgb, #9cc6ee 34%, transparent), transparent 70%),
			radial-gradient(420px 320px at 86% 64%, color-mix(in srgb, #f4c46c 24%, transparent), transparent 70%),
			radial-gradient(600px 400px at 10% 0%, var(--accent-soft), transparent 70%);
		animation: breathe 9s ease-in-out infinite;
	}
	@keyframes breathe {
		50% {
			opacity: 0.75;
		}
	}
	.hero-grid {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(0, 1.12fr);
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
	.plan-card {
		position: relative;
		display: grid;
		gap: 2px;
		width: fit-content;
		margin: 22px 0 0 auto;
		padding: 16px 20px;
		border-radius: 22px;
		background: var(--surface);
		box-shadow:
			inset 0 0 0 1px var(--line),
			0 24px 50px -28px rgb(0 0 0 / 0.45);
		font-size: var(--t-small);
		max-width: 360px;
		animation: float 9s ease-in-out infinite;
	}
	.plan-card .lbl {
		font-size: 0.6875rem;
		font-weight: 500;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--text-3);
	}
	.plan-card .big {
		font-size: 1.625rem;
		font-weight: 500;
		line-height: 1.15;
	}
	.plan-card p {
		color: var(--text-2);
	}
	.plan-card em {
		color: var(--text);
		font-size: 1.1em;
	}
	.plan-card i {
		display: inline-block;
		width: 8px;
		height: 8px;
		margin: 0 4px 1px 0;
		border-radius: 50%;
		background: var(--hue);
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
		.plan-card {
			margin: 18px auto 0;
			animation: none;
		}
	}

	/* the band of nevers */
	.band {
		border-block: 1px solid var(--line);
	}
	.nots {
		display: grid;
		grid-template-columns: repeat(4, minmax(0, 1fr));
	}
	.nots p {
		padding: 22px 0;
		font-size: 1.0625rem;
		font-weight: 500;
		letter-spacing: -0.01em;
	}
	.nots p + p {
		padding-left: 24px;
		border-left: 1px solid var(--line);
	}
	.x {
		font-family: var(--serif);
		font-style: italic;
		font-weight: 400;
		font-size: 1.25em;
		color: var(--seal);
		margin-right: 2px;
	}
	@media (max-width: 860px) {
		.nots {
			grid-template-columns: 1fr 1fr;
		}
		.nots p {
			padding: 16px 0;
			font-size: 0.9375rem;
		}
		.nots p + p {
			padding-left: 0;
			border-left: 0;
		}
		.nots p:nth-child(even) {
			padding-left: 16px;
			border-left: 1px solid var(--line);
		}
		.nots p:nth-child(n + 3) {
			border-top: 1px solid var(--line);
		}
	}

	/* scenes */
	.scene {
		padding-block: clamp(72px, 10vw, 136px);
	}
	.tint {
		background: color-mix(in srgb, var(--sunk) 55%, var(--bg));
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
		padding-left: 16px;
		border-left: 2px solid var(--accent);
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
		border-radius: 24px;
		overflow: hidden;
		box-shadow: 0 0 0 1px var(--line);
	}
	.fact {
		display: grid;
		align-content: start;
		gap: 10px;
		padding: 28px 24px 32px;
		background: var(--bg);
	}
	.fn {
		font-size: 2.5rem;
		font-weight: 500;
		line-height: 1;
		color: var(--text-3);
		opacity: 0.6;
		margin-bottom: 18px;
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
		.fn {
			margin-bottom: 6px;
			font-size: 1.75rem;
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
		border-radius: 24px;
		background: var(--surface);
		box-shadow: inset 0 0 0 1px var(--line);
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
		box-shadow: inset 0 0 0 1px var(--line);
		font-size: 0.8125rem;
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
	.card {
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
		box-shadow:
			inset 0 0 0 1px var(--line),
			0 40px 90px -50px rgb(0 0 0 / 0.4);
	}
	.card::before {
		content: '';
		position: absolute;
		inset: 0;
		z-index: -1;
		background:
			radial-gradient(500px 300px at 30% 0%, color-mix(in srgb, #9cc6ee 30%, transparent), transparent 70%),
			radial-gradient(500px 300px at 75% 100%, color-mix(in srgb, #f4c46c 22%, transparent), transparent 70%);
	}
	.card::after {
		content: '';
		position: absolute;
		inset: 0;
		z-index: -1;
		background-image: var(--grain);
		background-size: 180px;
		opacity: 0.18;
		mix-blend-mode: multiply;
	}
	.word {
		display: inline-flex;
		align-items: center;
		gap: clamp(12px, 2vw, 22px);
		font-size: clamp(3rem, 8vw, 6.5rem);
		font-weight: 600;
		letter-spacing: -0.05em;
		line-height: 1;
	}
	.word :global(svg) {
		width: clamp(52px, 8vw, 96px);
		height: auto;
	}
	.card .tagline {
		font-size: clamp(1.125rem, 2vw, 1.5rem);
		color: var(--text-2);
		letter-spacing: -0.02em;
		max-width: 26em;
	}
	.card .tagline em {
		color: var(--text);
	}
	.card .ctas {
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
		letter-spacing: 0.08em;
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
		.glow,
		.plan-card {
			animation: none;
		}
	}
</style>
