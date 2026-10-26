<script lang="ts">
	import { onDestroy } from 'svelte';
	import { liveQuery } from 'dexie';
	import { saveFragment } from '#lib/core/index.js';
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
		if (!listener) return;
		phase = 'stopping';
		let full = live;
		try {
			full = (await listener.stop()) || live;
		} catch {
			/* keep what we heard */
		}
		listener = null;
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

	onDestroy(() => {
		clearTimeout(slowTimer);
		clearTimeout(revealTimer);
		listener?.stop().catch(() => {});
	});
</script>

<svelte:head><title>Talk · Kizuna</title></svelte:head>

<div class="page talk">
	{#if phase === 'saved'}
		<section class="saved" in:soft>
			<div class="tick" aria-hidden="true"><Icon name="check" size={34} /></div>
			<h1 role="status">Got it.</h1>
			<div class="understood" aria-live="polite">
				{#if reveal && understood.value?.status === 'done'}
					{#if understood.value.chips.length}
						<p class="muted">Kizuna noted</p>
						<div class="row wrap chips">
							{#each understood.value.chips as c, i (c.key)}
								<span class="chip" style="animation-delay:{i * 70}ms">{cap(c.label)}</span>
							{/each}
						</div>
					{:else}
						<p class="muted">Kept with your notes.</p>
					{/if}
				{:else if understood.value?.status === 'failed'}
					<p class="muted">It’s kept safely, just as you said it.</p>
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
				<a class="btn big block" href="/">Back to Today</a>
			</div>
		</section>
	{:else}
		<div class="intro">
			<h1>What’s on your mind?</h1>
			<p class="muted">People, plans, little things. English, Hindi, or both.</p>
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
					<span class="ring" aria-hidden="true"></span>
					<Icon name={listening ? 'stop' : 'mic'} size={44} />
				</button>
				<p class="hint" aria-hidden="true">
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
					rows={micOk ? 4 : 7}
					bind:value={text}
					placeholder="Mum's appointment is Thursday. Kabir started his new job, should call him."
				></textarea>
			</label>
		{/if}

		{#if micNote}<p class="note" role="status">{micNote}</p>{/if}
		{#if saveNote}<p class="note" role="alert">{saveNote}</p>{/if}

		<button
			class="btn primary big block"
			type="button"
			onclick={save}
			disabled={!text.trim() || phase !== 'idle'}
		>
			{phase === 'saving' ? 'Saving…' : 'Save'}
		</button>
		<p class="tiny">Your notes stay on this phone.</p>
	{/if}
</div>

<style>
	.talk {
		gap: 22px;
	}
	.intro {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.mic-wrap {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 14px;
		padding: 18px 0 4px;
	}
	.mic {
		position: relative;
		width: 132px;
		height: 132px;
		border-radius: 50%;
		border: 0;
		display: grid;
		place-items: center;
		background: var(--accent);
		color: var(--on-accent);
		cursor: pointer;
		box-shadow: 0 16px 36px -14px color-mix(in srgb, var(--accent) 80%, transparent);
		transition: transform 200ms var(--ease);
	}
	.mic:active {
		transform: scale(0.96);
	}
	.mic:focus-visible {
		outline-offset: 6px;
		border-radius: 50%;
	}
	.ring {
		position: absolute;
		inset: -10px;
		border-radius: 50%;
		border: 2px solid var(--accent);
		opacity: 0;
		transform: scale(1);
		transition:
			transform 120ms linear,
			opacity var(--dur) var(--ease);
	}
	.mic.on .ring {
		opacity: calc(0.25 + var(--lv) * 0.6);
		transform: scale(calc(1 + var(--lv) * 0.22));
	}
	.mic.on {
		background: color-mix(in srgb, var(--accent) 88%, var(--text));
	}
	.hint {
		color: var(--text-2);
		font-weight: 560;
	}
	.live {
		min-height: 140px;
		padding: 18px;
		border-radius: var(--radius);
		background: var(--surface);
		border: 1px solid var(--line);
		font-size: 1.1875rem;
		line-height: 1.55;
	}
	.partial {
		color: var(--text-2);
	}
	.saved {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 14px;
		padding-top: 28px;
	}
	.tick {
		width: 64px;
		height: 64px;
		border-radius: 50%;
		display: grid;
		place-items: center;
		background: var(--accent-soft);
		color: var(--accent-ink);
	}
	.understood {
		min-height: 96px;
	}
	.chips {
		margin-top: 10px;
		gap: 8px;
	}
	.after {
		width: 100%;
		margin-top: 12px;
	}
	@media (prefers-reduced-motion: reduce) {
		.ring {
			transition: none;
		}
	}
</style>
