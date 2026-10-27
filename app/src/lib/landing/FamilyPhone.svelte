<script lang="ts">
	// A picture of the family page as a relative sees it after tapping the link in WhatsApp.
	// Drawn in HTML so it stays sharp and follows the theme; it's not interactive.
	const picked = 1;
	const chips = [
		['Sat morning', 'शनिवार सुबह'],
		['Sat evening', 'शनिवार शाम'],
		['Sun morning', 'रविवार सुबह'],
		['Sun evening', 'रविवार शाम']
	];
</script>

<div class="wrap" aria-hidden="true">
	<div class="phone">
		<div class="bar"><span class="url">kizuna… /c/·····</span></div>
		<div class="screen">
			<p class="eyebrow">Family call · परिवार कॉल</p>
			<p class="title">A family call is being planned.</p>
			<p class="sub">When are you free this weekend?<span lang="hi">इस वीकेंड आप कब फ़्री हैं?</span></p>
			<div class="chips">
				{#each chips as [en, hi], i (en)}
					<span class="chip" class:on={i === picked || i === 2}>{en}<small lang="hi">{hi}</small></span>
				{/each}
			</div>
			<span class="send">Send · भेजें</span>
			<span class="mic">Speak instead · बोलकर बताइए</span>
			<p class="fine">Only your family circle can read your answer. Times only, never your location.</p>
		</div>
	</div>
	<div class="tag t1"><i class="lock"></i>Sealed on her phone</div>
	<div class="tag t2"><i style="--hue:#b6a4f4"></i><em>Riya</em> answered · Sat evening</div>
</div>

<style>
	.wrap {
		position: relative;
		width: min(100%, 340px);
		margin: 0 auto;
		padding: 24px 0;
	}
	.phone {
		border-radius: 40px;
		padding: 10px;
		background: var(--surface);
		box-shadow:
			inset 0 0 0 1px var(--line),
			0 40px 90px -40px rgb(0 0 0 / 0.45);
	}
	.bar {
		display: flex;
		justify-content: center;
		padding: 10px 0 8px;
	}
	.url {
		font-size: 0.75rem;
		color: var(--text-3);
		padding: 4px 12px;
		border-radius: 999px;
		background: var(--sunk);
	}
	.screen {
		display: flex;
		flex-direction: column;
		gap: 12px;
		padding: 16px 16px 20px;
		border-radius: 30px;
		background: var(--bg);
	}
	.eyebrow {
		font-size: 0.6875rem;
		font-weight: 500;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--text-3);
	}
	.title {
		font-size: 1.5rem;
		line-height: 1.1;
		font-weight: 500;
		letter-spacing: -0.03em;
	}
	.sub {
		font-size: 0.875rem;
		color: var(--text-2);
	}
	.sub span {
		display: block;
		color: var(--text-3);
	}
	.chips {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 8px;
	}
	.chip {
		display: flex;
		flex-direction: column;
		padding: 10px 12px;
		border-radius: 16px;
		box-shadow: inset 0 0 0 1px var(--line);
		font-size: 0.875rem;
		font-weight: 500;
	}
	.chip small {
		font-size: 0.75rem;
		font-weight: 400;
		color: var(--text-3);
	}
	.chip.on {
		background: var(--accent-soft);
		box-shadow: inset 0 0 0 1.5px var(--accent);
	}
	.send,
	.mic {
		display: grid;
		place-items: center;
		min-height: 42px;
		border-radius: 999px;
		font-size: 0.875rem;
		font-weight: 500;
	}
	.send {
		background: var(--accent);
		color: var(--on-accent);
	}
	.mic {
		box-shadow: inset 0 0 0 1px var(--line);
	}
	.fine {
		font-size: 0.75rem;
		color: var(--text-3);
		line-height: 1.4;
	}
	.tag {
		position: absolute;
		display: inline-flex;
		align-items: center;
		gap: 8px;
		padding: 9px 14px;
		border-radius: 999px;
		background: var(--surface);
		box-shadow:
			inset 0 0 0 1px var(--line),
			0 16px 34px -18px rgb(0 0 0 / 0.45);
		font-size: 0.8125rem;
		white-space: nowrap;
		animation: float 8s ease-in-out infinite;
	}
	.tag em {
		font-size: 1.05rem;
	}
	.tag i {
		width: 9px;
		height: 9px;
		border-radius: 50%;
		background: var(--hue, var(--accent));
	}
	.tag .lock {
		width: 12px;
		height: 12px;
		border-radius: 3px;
		background: none;
		box-shadow: inset 0 0 0 1.5px var(--text);
		position: relative;
	}
	.tag .lock::before {
		content: '';
		position: absolute;
		left: 2.5px;
		top: -5px;
		width: 7px;
		height: 7px;
		border: 1.5px solid var(--text);
		border-bottom: 0;
		border-radius: 5px 5px 0 0;
		box-sizing: border-box;
	}
	.t1 {
		top: 0;
		left: -72px;
	}
	.t2 {
		bottom: 0;
		right: -64px;
		animation-delay: -4s;
	}
	@keyframes float {
		50% {
			transform: translateY(-8px);
		}
	}
	@media (max-width: 560px) {
		.t1 {
			left: -4px;
		}
		.t2 {
			right: -4px;
		}
	}
</style>
