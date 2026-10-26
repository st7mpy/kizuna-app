<script lang="ts">
	import { onMount } from 'svelte';
	import { liveQuery } from 'dexie';
	import type { Card, Person, Room, Settings } from '@kizuna/shared';
	import { answerCard, loadSampleLife, setRoom, todayCards } from '#lib/core/index.js';
	import { allPeople, db, hasAnyData, settingsLive } from '#lib/db.js';
	import { watch } from '#lib/ui/live.svelte.js';
	import { dayKey, greeting } from '#lib/ui/format.js';
	import { fold, soft } from '#lib/ui/motion.js';
	import Segmented from '#lib/ui/Segmented.svelte';
	import PokeSheet from '#lib/ui/PokeSheet.svelte';
	import TimeSheet from '#lib/ui/TimeSheet.svelte';
	import Icon from '#lib/ui/Icon.svelte';
	import { hueFor } from '#lib/ui/hue.js';

	const settings = watch<Settings | undefined>(() => settingsLive(), undefined);
	const hasData = watch(() => hasAnyData(), false);
	const people = watch<Person[]>(() => allPeople(), []);
	// Changes when notes get understood or people appear, so Today can refresh quietly.
	const pulse = watch(
		() =>
			liveQuery(async () =>
				[
					await db.people.count(),
					await db.events.count(),
					await db.fragments.where('status').equals('done').count()
				].join('-')
			),
		''
	);

	let cards: Card[] = $state([]);
	let loaded = $state(false);
	let failed = $state(false);
	let sampling = $state(false);
	let sampleFailed = $state(false);

	const now = new Date();
	const hello = greeting(now.getHours());
	const myName = $derived(settings.value?.myName?.trim() ?? '');
	const dateLine = now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
	const room = $derived<Room | null>(
		settings.value?.room?.day === dayKey() ? settings.value.room.level : null
	);
	const byId = $derived(new Map(people.value.map((p) => [p.id, p])));

	async function load() {
		try {
			cards = await todayCards();
			failed = false;
		} catch {
			failed = true;
		} finally {
			loaded = true;
		}
	}

	onMount(load);

	let lastPulse = '';
	let timer: ReturnType<typeof setTimeout> | undefined;
	$effect(() => {
		const p = pulse.value;
		if (!p || p === lastPulse) return;
		const first = lastPulse === '';
		lastPulse = p;
		if (first) return;
		clearTimeout(timer);
		timer = setTimeout(load, 400);
	});

	async function pickRoom(level: Room) {
		try {
			await setRoom(level);
		} catch {
			/* still show cards */
		}
		await load();
	}

	function drop(promptId: string) {
		cards = cards.filter((c) => c.promptId !== promptId);
	}

	async function answer(card: Card, a: 'not_now' | 'done' | 'keep') {
		drop(card.promptId);
		try {
			await answerCard(card.promptId, a);
		} catch {
			/* nothing to undo; it simply shows again another day */
		}
	}

	async function trySample() {
		sampling = true;
		sampleFailed = false;
		try {
			await loadSampleLife();
			await load();
		} catch {
			sampleFailed = true;
		} finally {
			sampling = false;
		}
	}

	// sheets
	let pokeOpen = $state(false);
	let timeOpen = $state(false);
	let active = $state<Card | null>(null);
	const activePerson = $derived(active?.personId ? byId.get(active.personId) : undefined);

	function poke(card: Card) {
		active = card;
		pokeOpen = true;
	}
	function findTime(card: Card) {
		active = card;
		timeOpen = true;
	}

	const firstRun = $derived(hasData.ready && !hasData.value && loaded && cards.length === 0);
</script>

<svelte:head><title>Today · Kizuna</title></svelte:head>

<div class="page">
	{#if firstRun}
		<section class="welcome" in:soft>
			<div class="head">
				<p class="label">Welcome</p>
				<h1>Keep your thoughts and your <em>people</em> from slipping away.</h1>
			</div>
			<div class="stack">
				<a href="/talk" class="btn primary big block"><Icon name="mic" size={22} /> Talk to Kizuna</a>
				<button class="btn line big block" type="button" onclick={trySample} disabled={sampling}>
					{sampling ? 'Setting up a sample life…' : 'Try with sample life'}
				</button>
			</div>
			<ol class="rows open-top steps">
				<li><span class="n num">01</span><span>Say what’s on your mind, in English, Hindi or both.</span></li>
				<li><span class="n num">02</span><span>Kizuna remembers the people, dates and plans.</span></li>
				<li><span class="n num">03</span><span>It speaks up only when there’s a good moment, or stays quiet.</span></li>
			</ol>
			<div class="window hero" style="--hue:#9cc6ee" aria-hidden="true">
				<span class="sun"></span>
			</div>
			{#if sampleFailed}
				<p class="note" role="status">Couldn’t load the sample just now. Try again in a moment.</p>
			{/if}
		</section>
	{:else}
		<div class="head">
			<p class="label">{dateLine}</p>
			<h1>{hello}{#if myName},<br /><em>{myName}</em>{/if}</h1>
		</div>

		<section class="room" aria-labelledby="room-q">
			<h2 id="room-q" class="label">How much room today?</h2>
			<Segmented
				label="How much room today?"
				value={room}
				options={[
					{ value: 'low', label: 'A little' },
					{ value: 'some', label: 'Some' },
					{ value: 'lots', label: 'Lots' }
				]}
				onchange={pickRoom}
			/>
		</section>

		<section class="moments" aria-label="For today" aria-live="polite">
			{#each cards as card (card.promptId)}
				<article class="moment" class:thread={card.kind === 'thread'} out:fold in:soft>
					{#if card.kind === 'suggest_circle'}
						<p class="label">Someone who comes up a lot</p>
						<h2 class="who">Keep <em>{card.title}</em> close?</h2>
						<p class="reason">{card.reason}</p>
						<div class="actions">
							<button class="btn accent" type="button" onclick={() => answer(card, 'keep')}>Keep close</button>
							<button class="btn quiet" type="button" onclick={() => answer(card, 'not_now')}>Not now</button>
						</div>
					{:else if card.kind === 'thread'}
						<p class="label">Yours</p>
						<h2 class="what">{card.title}</h2>
						{#if card.reason}<p class="reason">{card.reason}</p>{/if}
						<div class="actions">
							<button class="btn accent" type="button" onclick={() => answer(card, 'done')}>
								<Icon name="check" size={20} /> Done
							</button>
							<button class="btn quiet" type="button" onclick={() => answer(card, 'not_now')}>Not now</button>
						</div>
					{:else}
						<h2 class="who">
							<span class="dot" style="--hue:{hueFor(card.personId)}" aria-hidden="true"></span>
							{#if card.personId}
								<a class="name" href="/circle/{card.personId}"><em>{card.title}</em></a>
							{:else}
								<em>{card.title}</em>
							{/if}
						</h2>
						<p class="reason">{card.reason}</p>
						<div class="actions">
							<button class="btn accent" type="button" onclick={() => poke(card)}>Poke</button>
							<button class="btn" type="button" onclick={() => findTime(card)}>Find a time</button>
							<button class="btn quiet" type="button" onclick={() => answer(card, 'not_now')}>Not now</button>
						</div>
					{/if}
				</article>
			{/each}

			{#if loaded && cards.length === 0}
				<div class="empty" in:soft>
					{#if failed}
						<p class="calm">Today is still <em>waking up</em>.</p>
						<p class="muted">Your notes are safe. Try again in a moment.</p>
						<button class="btn line" type="button" onclick={load}>Try again</button>
					{:else}
						<p class="calm">Nothing needs you <em>today</em>.</p>
						<p class="muted">Kizuna will speak up when there’s a good reason.</p>
					{/if}
				</div>
			{/if}
		</section>

		<a href="/threads" class="threads">
			<span class="t">Your threads</span>
			<span class="sub"><em>ideas, plans, promises, errands</em></span>
			<span class="icon-btn solid" aria-hidden="true"><Icon name="arrow" size={20} /></span>
		</a>
	{/if}
</div>

<PokeSheet
	bind:open={pokeOpen}
	person={activePerson}
	reason={active?.reason}
	promptId={active?.promptId}
	onsent={() => active && drop(active.promptId)}
/>
<TimeSheet
	bind:open={timeOpen}
	person={activePerson}
	promptId={active?.promptId}
	onshared={() => active && drop(active.promptId)}
/>

<style>
	.welcome {
		display: flex;
		flex-direction: column;
		gap: 28px;
	}
	.welcome h1 {
		font-size: 2.625rem;
	}
	.hero {
		height: 132px;
		border-radius: 28px;
	}
	.sun {
		position: absolute;
		right: 28px;
		top: 26px;
		width: 34px;
		height: 34px;
		border-radius: 50%;
		background: var(--seal);
		opacity: 0.9;
	}
	.steps {
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.steps li {
		display: grid;
		grid-template-columns: 36px 1fr;
		gap: 8px;
		padding: 14px 0;
		color: var(--text-2);
		line-height: 1.45;
	}
	.steps .n {
		font-size: var(--t-small);
		color: var(--text);
		font-weight: 500;
	}
	.room {
		display: flex;
		flex-direction: column;
		gap: 2px;
		margin-top: -4px;
	}
	.moments {
		display: flex;
		flex-direction: column;
		margin-top: -14px;
	}
	.moment {
		display: flex;
		flex-direction: column;
		gap: 6px;
		padding: 22px 0 10px;
		border-bottom: 1px solid var(--line);
	}
	.who {
		display: flex;
		align-items: center;
		gap: 12px;
		font-size: var(--t-title);
		line-height: 1.1;
		letter-spacing: -0.02em;
	}
	.who em {
		font-size: 1.12em;
	}
	.who .dot {
		width: 12px;
		height: 12px;
		margin-top: 4px;
	}
	.name {
		color: inherit;
		text-decoration: none;
	}
	.what {
		font-size: 1.375rem;
		line-height: 1.2;
		letter-spacing: -0.02em;
	}
	.reason {
		color: var(--text-2);
		max-width: 34ch;
	}
	.actions {
		display: flex;
		align-items: center;
		gap: 22px;
		margin-top: 4px;
	}
	.actions .quiet {
		margin-left: auto;
	}
	.empty {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 8px;
		padding: 28px 0 8px;
	}
	.empty .btn {
		margin-top: 10px;
	}
	.threads {
		display: grid;
		grid-template-columns: 1fr auto;
		grid-template-areas: 't i' 's i';
		align-items: center;
		column-gap: 14px;
		padding: 18px 0;
		border-top: 2px solid var(--rule);
		color: var(--text);
		text-decoration: none;
		margin-top: 8px;
	}
	.threads .t {
		grid-area: t;
		font-size: 1.375rem;
		font-weight: 500;
		letter-spacing: -0.02em;
	}
	.threads .sub {
		grid-area: s;
		color: var(--text-2);
		font-size: var(--t-lead);
	}
	.threads .icon-btn {
		grid-area: i;
	}
	.threads:focus-visible {
		outline-offset: 4px;
	}
</style>
