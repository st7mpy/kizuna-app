<script lang="ts">
	import { onDestroy } from 'svelte';
	import { liveQuery } from 'dexie';
	import { retryFragment, saveFragment } from '#lib/core/index.js';
	import { startListening, voiceSupported, type Listener } from '#lib/voice/index.js';
	import { db } from '#lib/db.js';
	import { watch } from '#lib/ui/live.svelte.js';
	import { cap, dayLabel } from '#lib/ui/format.js';
	import { soft } from '#lib/ui/motion.js';
	import Icon from '#lib/ui/Icon.svelte';

	type Phase = 'idle' | 'starting' | 'listening' | 'stopping' | 'saving' | 'saved';
	let phase = $state<Phase>('idle');
	let text = $state('');
	let heard = $state(''); // finished turns while listening
	let partial = $state(''); // the turn being spoken
	let level = $state(0);
	let usedVoice = $state(false);
	let micOk = $state(voiceSupported());
	const canTalk = voiceSupported();
	let micNote = $state(canTalk ? '' : 'Typing works just as well here.');
	let saveNote = $state('');
	let savedId = $state<string | null>(null);
	let slow = $state(false);
	let listener: Listener | null = null;
	let slowTimer: ReturnType<typeof setTimeout> | undefined;
	let revealTimer: ReturnType<typeof setTimeout> | undefined;
	let reveal = $state(false);

	const live = $derived([heard, partial].filter(Boolean).join(' '));
	const listening = $derived(phase === 'listening' || phase === 'starting');

	async function toggleMic() {
		if (phase === 'listening') return stop();
		if (phase !== 'idle') return;
		phase = 'starting';
		heard = '';
		partial = '';
		micNote = '';
		try {
			listener = await startListening({
				onPartial: (t) => (partial = t),
				onFinal: (t) => {
					heard = [heard, t].filter(Boolean).join(' ');
					partial = '';
				},
				onError: (m) => {
					micNote = m || 'The words didn’t come through. Typing works too.';
				},
				onLevel: (l) => (level = l)
			});
			phase = 'listening';
			usedVoice = true;
		} catch (e) {
			phase = 'idle';
			const denied = (e as DOMException)?.name === 'NotAllowedError';
			micOk = !denied && voiceSupported();
			micNote = denied
				? 'The mic is off for Kizuna, so type instead. It works just as well.'
				: 'Couldn’t start the mic just now. Typing works just as well.';
		}
	}

	async function stop() {
		const l = listener;
		if (!l) return;
		listener = null;
		phase = 'stopping';
		let full = live;
		try {
			full = (await l.stop()) || live;
		} catch {
			/* keep what we heard */
		}
		level = 0;
		text = [text.trim(), full.trim()].filter(Boolean).join(' ');
		heard = '';
		partial = '';
		phase = 'idle';
	}

	async function save() {
		const t = text.trim();
		if (!t) return;
		phase = 'saving';
		saveNote = '';
		try {
			const f = await saveFragment(t, usedVoice ? 'voice' : 'typed');
			savedId = f.id;
			phase = 'saved';
			reveal = false;
			revealTimer = setTimeout(() => (reveal = true), 700);
			slowTimer = setTimeout(() => (slow = true), 8000);
		} catch {
			phase = 'idle';
			saveNote = 'Couldn’t save that just now. Your words are still here; try again.';
		}
	}

	function again() {
		clearTimeout(slowTimer);
		clearTimeout(revealTimer);
		text = '';
		savedId = null;
		slow = false;
		reveal = false;
		usedVoice = false;
		phase = 'idle';
	}

	// What Kizuna understood from the saved note, once it has been read.
	type Understood = {
		status: 'new' | 'done' | 'failed';
		chips: { key: string; label: string }[];
	} | null;
	const understood = watch<Understood>(() => {
		const id = savedId;
		return liveQuery(async (): Promise<Understood> => {
			if (!id) return null;
			const f = await db.fragments.get(id);
			if (!f) return null;
			if (f.status !== 'done') return { status: f.status, chips: [] };
			const events = await db.events.where('fragmentId').equals(id).toArray();
			const pids = [...new Set([...(f.personIds ?? []), ...events.flatMap((e) => e.personIds)])];
			const people = (await db.people.bulkGet(pids)).filter((p) => !!p);
			const threads = await db.threads.filter((t) => t.fragmentIds.includes(id)).toArray();
			return {
				status: 'done',
				chips: [
					...people.map((p) => ({ key: 'p' + p.id, label: p.name })),
					...events.map((e) => ({
						key: 'e' + e.id,
						label: `${e.day ? dayLabel(e.day) : (e.dateText ?? '')} ${e.what}`.trim()
					})),
					...threads.map((t) => ({ key: 't' + t.id, label: t.title }))
				]
			};
		});
	}, null);

	// Leaving while the mic is on must not lose the words: stop, then keep what was heard.
	let flushing = false;
	async function flush() {
		const l = listener;
		if (flushing) return;
		if (!l) {
			// A tap on stop may still be finishing; its words are in live until then.
			if (phase === 'stopping' && live.trim()) {
				flushing = true;
				await saveFragment([text.trim(), live.trim()].filter(Boolean).join(' '), 'voice').catch(() => {});
			}
			return;
		}
		flushing = true;
		listener = null;
		const typed = text.trim();
		let said = live.trim();
		try {
			said = ((await l.stop()) || said).trim();
		} catch {
			/* keep what we heard */
		}
		const full = [typed, said].filter(Boolean).join(' ');
		if (said && full) await saveFragment(full, 'voice').catch(() => {});
	}

	let retrying = $state(false);
	async function retry() {
		if (!savedId) return;
		retrying = true;
		try {
			await retryFragment(savedId);
		} catch {
			/* it stays kept; Kizuna tries again later */
		} finally {
			retrying = false;
		}
	}

	onDestroy(() => {
		clearTimeout(slowTimer);
		clearTimeout(revealTimer);
		void flush();
	});
</script>

<svelte:head><title>Talk · Kizuna</title></svelte:head>

<svelte:window onpagehide={() => void flush()} />

<div class="page talk">
	{#if phase === 'saved'}
		<section class="saved" in:soft>
			<span class="icon-btn solid tick" aria-hidden="true"><Icon name="check" size={22} stroke={2} /></span>
			<div class="head">
				<p class="label">Saved on this phone</p>
				<h1 role="status">Got <em>it</em>.</h1>
			</div>
			<div class="understood" aria-live="polite">
				{#if reveal && understood.value?.status === 'done'}
					{#if understood.value.chips.length}
						<p class="label">Kizuna noted</p>
						<div class="row wrap chips">
							{#each understood.value.chips as c, i (c.key)}
								<span class="tag" style="animation-delay:{i * 70}ms">{cap(c.label)}</span>
							{/each}
						</div>
					{:else}
						<p class="muted">Kept with your notes.</p>
					{/if}
				{:else if understood.value?.status === 'failed'}
					<p class="retry muted">
						Couldn’t read this one yet ·
						<button class="btn accent" type="button" onclick={retry} disabled={retrying}>
							{retrying ? 'Trying…' : 'Try again'}
						</button>
					</p>
					<p class="tiny">It’s kept safely, just as you said it.</p>
				{:else if slow}
					<p class="muted">Saved on your phone. Kizuna will read it properly once you’re online.</p>
				{:else}
					<p class="muted">Reading it…</p>
				{/if}
			</div>
			<div class="stack after">
				<button class="btn primary big block" type="button" onclick={again}>
					<Icon name="mic" size={22} /> Add another
				</button>
				<a class="btn line big block" href="/">Back to Today</a>
			</div>
		</section>
	{:else}
		<div class="head">
			<p class="label">Talk</p>
			<h1>What’s on <em>your</em> mind?</h1>
			<p class="lede">People, plans, little things. English, Hindi, or both.</p>
		</div>

		{#if micOk}
			<div class="mic-wrap">
				<button
					class="mic"
					class:on={listening}
					type="button"
					aria-pressed={listening}
					aria-label={listening ? 'Stop listening' : 'Start talking'}
					onclick={toggleMic}
					disabled={phase === 'stopping' || phase === 'saving'}
					style="--lv:{level}"
				>
					<span class="ring r1" aria-hidden="true"></span>
					<span class="ring r2" aria-hidden="true"></span>
					<Icon name={listening ? 'stop' : 'mic'} size={38} stroke={1.6} />
				</button>
				<p class="hint" aria-hidden="true">
					{#if listening}<span class="rec"></span>{/if}
					{phase === 'starting'
						? 'Opening the mic…'
						: phase === 'listening'
							? 'Listening. Tap to stop.'
							: phase === 'stopping'
								? 'Finishing…'
								: 'Tap to talk'}
				</p>
			</div>
		{/if}

		{#if listening || phase === 'stopping'}
			<div class="live" aria-live="polite" aria-label="Live words">
				{#if live}
					{heard}{#if partial}<span class="partial"> {partial}</span>{/if}
				{:else}
					<span class="muted">Go ahead, take your time.</span>
				{/if}
			</div>
		{:else}
			<label class="field">
				<span>{micOk ? 'Or type it' : 'Type it here'}</span>
				<textarea
					rows={micOk ? 3 : 6}
					bind:value={text}
					placeholder="Mum's appointment is Thursday. Kabir started his new job, should call him."
				></textarea>
			</label>
		{/if}

		{#if micNote}<p class="note" role="status">{micNote}</p>{/if}
		{#if saveNote}<p class="note" role="alert">{saveNote}</p>{/if}

		<div class="stack">
			<button
				class="btn primary big block"
				type="button"
				onclick={save}
				disabled={!text.trim() || phase !== 'idle'}
			>
				{phase === 'saving' ? 'Saving…' : 'Save'}
			</button>
			<p class="tiny center">Your notes stay on this phone.</p>
		</div>
	{/if}
</div>

<style>
	.mic-wrap {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 18px;
		padding: 8px 0 0;
	}
	.mic {
		position: relative;
		width: 120px;
		height: 120px;
		border-radius: 50%;
		border: 0;
		display: grid;
		place-items: center;
		background: var(--accent);
		color: var(--on-accent);
		cursor: pointer;
		transition: transform 200ms var(--ease);
	}
	.mic:active {
		transform: scale(0.96);
	}
	.mic:focus-visible {
		outline-offset: 8px;
		border-radius: 50%;
	}
	/* Hairline rings that breathe with the voice. */
	.ring {
		position: absolute;
		border-radius: 50%;
		box-shadow: 0 0 0 1px var(--line);
		transition:
			transform 120ms linear,
			box-shadow var(--dur) var(--ease);
	}
	.r1 {
		inset: -14px;
	}
	.r2 {
		inset: -30px;
		opacity: 0.6;
	}
	.mic.on .ring {
		box-shadow: 0 0 0 1px var(--accent);
	}
	.mic.on .r1 {
		transform: scale(calc(1 + var(--lv) * 0.12));
	}
	.mic.on .r2 {
		transform: scale(calc(1 + var(--lv) * 0.22));
	}
	.hint {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		margin-top: 18px;
		color: var(--text-2);
		font-size: var(--t-small);
		font-weight: 500;
	}
	.rec {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: var(--seal);
	}
	.live {
		min-height: 140px;
		padding: 16px 0;
		border-top: 1px solid var(--line);
		border-bottom: 1px solid var(--line);
		font-size: 1.375rem;
		line-height: 1.45;
		letter-spacing: -0.015em;
	}
	.partial {
		color: var(--text-3);
	}
	textarea {
		font-size: var(--t-lead);
	}
	.center {
		text-align: center;
	}
	.saved {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 22px;
		padding-top: 20px;
	}
	.saved .head {
		padding-top: 0;
	}
	.tick {
		width: 52px;
		height: 52px;
	}
	.understood {
		min-height: 96px;
		width: 100%;
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.retry {
		display: flex;
		align-items: center;
		gap: 8px;
		flex-wrap: wrap;
	}
	.chips {
		gap: 8px;
	}
	.after {
		width: 100%;
		margin-top: 8px;
	}
	@media (prefers-reduced-motion: reduce) {
		.ring {
			transition: none;
		}
	}
	/* Wider screens: one calm column in the middle. */
	@media (min-width: 720px) {
		.page.talk {
			max-width: 640px;
			padding-top: calc(56px + var(--safe-t));
		}
	}
</style>
