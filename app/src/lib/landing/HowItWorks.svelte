<script lang="ts">
	// Three steps, each with a small live picture: a note typed out as if spoken, what Kizuna
	// took from it, and the nudge that comes later. Plays once when it scrolls into view.
	import { onMount } from 'svelte';
	import { reveal } from './reveal.js';

	const NOTE =
		'Mum ka appointment Thursday hai. Kabir ne naya job join kiya, should call him. Riya wants to do something for Papa’s birthday.';

	let typed = $state('');
	let stage = $state(0); // 0 waiting, 1 typing, 2 understood, 3 nudge
	let root: HTMLElement;

	onMount(() => {
		const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
		if (still || typeof IntersectionObserver === 'undefined') {
			typed = NOTE;
			stage = 3;
			return;
		}
		const timers: ReturnType<typeof setTimeout>[] = [];
		const play = () => {
			stage = 1;
			let i = 0;
			const tick = () => {
				i = Math.min(NOTE.length, i + 1 + Math.floor(Math.random() * 2));
				typed = NOTE.slice(0, i);
				if (i < NOTE.length) timers.push(setTimeout(tick, 22 + Math.random() * 30));
				else {
					timers.push(setTimeout(() => (stage = 2), 350));
					timers.push(setTimeout(() => (stage = 3), 1500));
				}
			};
			tick();
		};
		const io = new IntersectionObserver(
			(es) => {
				if (es.some((e) => e.isIntersecting)) {
					io.disconnect();
					timers.push(setTimeout(play, 300));
				}
			},
			{ threshold: 0.3 }
		);
		io.observe(root);
		return () => {
			io.disconnect();
			timers.forEach(clearTimeout);
		};
	});
</script>

<ol class="steps" bind:this={root}>
	<li class="step" use:reveal={0}>
		<div class="top">
			<span class="n">Talk</span>
			<h3>Talk it out</h3>
			<p>Hold the mic and say what’s on your mind, in English, Hindi or both. Words appear as you speak.</p>
		</div>
		<div class="pic note" aria-hidden="true">
			<div class="listen">
				<span class="rec" class:on={stage === 1}></span>
				<span class="lbl">{stage === 1 ? 'Listening' : 'Your note'}</span>
			</div>
			<p class="said">{typed}<span class="caret" class:hide={stage > 1}></span></p>
		</div>
		<p class="sr-only">Example note: {NOTE}</p>
	</li>

	<li class="step" use:reveal={120}>
		<div class="top">
			<span class="n">Remember</span>
			<h3>Kizuna remembers</h3>
			<p>It picks out the people, dates and promises inside what you said. Your circle builds itself.</p>
		</div>
		<div class="pic got" class:on={stage >= 2} aria-hidden="true">
			<span class="lbl">Understood</span>
			<ul>
				<li style="--k:0"><i style="--hue:#a4c6e8"></i><em>Mum</em><span>appointment, Thursday</span></li>
				<li style="--k:1"><i style="--hue:#eba596"></i><em>Kabir</em><span>new job · call him</span></li>
				<li style="--k:2"><i style="--hue:#bcb2e6"></i><em>Riya</em><span>plan for Papa</span></li>
				<li style="--k:3"><i style="--hue:#cbd49e"></i><em>Papa</em><span>birthday coming up</span></li>
			</ul>
			<p class="merge" style="--k:4">Ma, Mum and Mummy are the same person.</p>
		</div>
	</li>

	<li class="step" use:reveal={240}>
		<div class="top">
			<span class="n">Nudge</span>
			<h3>A nudge at the right moment</h3>
			<p>Only when there’s a reason and a free time. You get a ready line, edit it, and send it in WhatsApp yourself.</p>
		</div>
		<div class="pic nudge" class:on={stage >= 3} aria-hidden="true">
			<span class="lbl">For today</span>
			<p class="who"><i style="--hue:#eba596"></i><em>Kabir</em></p>
			<p class="why">Started his new job. You said you’d call.</p>
			<p class="when"><b>Sat 19:00</b> your time · 08:30 in Toronto</p>
			<p class="line">Kabir! Naya job kaisa chal raha hai? Saturday ko call karein?</p>
			<span class="wa">Open WhatsApp</span>
		</div>
	</li>
</ol>

<style>
	.steps {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		grid-auto-rows: auto;
		column-gap: clamp(20px, 2.4vw, 32px);
	}
	.step {
		display: grid;
		grid-row: span 2;
		grid-template-rows: subgrid;
		row-gap: 24px;
		min-width: 0;
	}
	.top {
		display: grid;
		gap: 10px;
	}
	.n {
		font-size: 0.75rem;
		font-weight: 500;
		letter-spacing: 0.16em;
		text-transform: uppercase;
		color: var(--accent-ink);
	}
	h3 {
		font-size: 1.375rem;
		line-height: 1.2;
		letter-spacing: -0.02em;
		text-transform: none;
		color: var(--text);
	}
	.top p {
		color: var(--text-2);
		font-size: var(--t-small);
		max-width: 34ch;
	}
	.pic {
		position: relative;
		flex: 1;
		min-height: 268px;
		border-radius: var(--r-card);
		background: var(--surface);
		box-shadow: var(--card-shadow), 0 24px 60px -36px rgb(60 45 20 / 0.35);
		padding: 22px;
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
	.lbl {
		font-size: var(--t-label);
		font-weight: 500;
		letter-spacing: 0.14em;
		text-transform: uppercase;
		color: var(--text-3);
	}
	.listen {
		display: flex;
		align-items: center;
		gap: 10px;
	}
	.rec {
		width: 10px;
		height: 10px;
		border-radius: 50%;
		background: var(--line-2);
		transition: background 300ms;
	}
	.rec.on {
		background: var(--accent);
		animation: beat 1.1s ease-in-out infinite;
	}
	@keyframes beat {
		50% {
			box-shadow: 0 0 0 6px var(--accent-soft);
		}
	}
	.said {
		font-size: 1.1875rem;
		line-height: 1.4;
		letter-spacing: -0.015em;
		color: var(--text);
		min-height: 5.3em;
	}
	.caret {
		display: inline-block;
		width: 2px;
		height: 1em;
		margin-left: 2px;
		vertical-align: -0.12em;
		background: var(--accent);
		animation: blink 1s steps(1) infinite;
	}
	.caret.hide {
		display: none;
	}
	@keyframes blink {
		50% {
			opacity: 0;
		}
	}
	.got ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 8px;
	}
	.got li,
	.merge {
		display: flex;
		align-items: baseline;
		gap: 10px;
		padding: 9px 14px;
		border-radius: 12px;
		background: var(--bg-2);
		font-size: var(--t-small);
		opacity: 0;
		transform: translateY(8px);
		transition:
			opacity 500ms var(--ease),
			transform 600ms var(--ease);
		transition-delay: calc(var(--k) * 140ms);
	}
	.got li i,
	.who i {
		flex: none;
		align-self: center;
		width: 10px;
		height: 10px;
		border-radius: 50%;
		background: var(--hue);
	}
	.got li em {
		font-weight: 500;
	}
	.got li span {
		color: var(--text-2);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.merge {
		background: transparent;
		box-shadow: none;
		padding: 2px 0;
		color: var(--text-3);
		font-size: 0.8125rem;
	}
	.got.on li,
	.got.on .merge {
		opacity: 1;
		transform: none;
	}
	.nudge > * {
		opacity: 0;
		transform: translateY(8px);
		transition:
			opacity 500ms var(--ease),
			transform 600ms var(--ease);
	}
	.nudge.on > * {
		opacity: 1;
		transform: none;
	}
	.nudge.on > :nth-child(2) {
		transition-delay: 80ms;
	}
	.nudge.on > :nth-child(3) {
		transition-delay: 160ms;
	}
	.nudge.on > :nth-child(4) {
		transition-delay: 240ms;
	}
	.nudge.on > :nth-child(5) {
		transition-delay: 420ms;
	}
	.nudge.on > :nth-child(6) {
		transition-delay: 620ms;
	}
	.who {
		display: flex;
		align-items: center;
		gap: 10px;
		font-size: 1.5rem;
		font-weight: 500;
		letter-spacing: -0.03em;
		line-height: 1.1;
		margin-top: 2px;
	}
	.why {
		color: var(--text-2);
		font-size: var(--t-small);
	}
	.when {
		font-size: var(--t-small);
		color: var(--text-2);
	}
	.when b {
		color: var(--text);
		font-weight: 500;
	}
	.line {
		padding: 12px 14px;
		border-radius: 16px 16px 16px 6px;
		background: var(--accent-soft);
		color: var(--text);
		font-size: var(--t-small);
		line-height: 1.4;
	}
	.wa {
		align-self: flex-start;
		display: inline-flex;
		align-items: center;
		min-height: 40px;
		padding: 0 18px;
		border-radius: 999px;
		background: var(--accent);
		color: var(--on-accent);
		font-size: var(--t-small);
		font-weight: 500;
	}
	@media (max-width: 960px) {
		.steps {
			grid-template-columns: minmax(0, 1fr);
			max-width: 520px;
			margin: 0 auto;
			row-gap: 48px;
		}
		.step {
			display: flex;
			flex-direction: column;
			gap: 24px;
			grid-row: auto;
		}
		.pic {
			min-height: 0;
		}
	}
</style>
