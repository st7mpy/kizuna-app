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
	const hello = $derived(greeting(now.getHours(), settings.value?.myName));
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
	<div class="top">
		<div>
			<h1>{hello}</h1>
			<p class="muted">{dateLine}</p>
		</div>
		<a href="/settings" class="icon-btn" aria-label="Settings"><Icon name="gear" /></a>
	</div>

	{#if firstRun}
		<section class="card welcome" in:soft>
			<h2>Kizuna keeps your thoughts and your people from slipping away.</h2>
			<p class="muted">
				Say what’s on your mind. It remembers the people and dates, and speaks up only when there’s a good moment.
			</p>
			<div class="stack">
				<a href="/talk" class="btn primary big block"><Icon name="mic" size={22} /> Talk to Kizuna</a>
				<button class="btn big block" type="button" onclick={trySample} disabled={sampling}>
					{sampling ? 'Setting up a sample life…' : 'Try with sample life'}
				</button>
			</div>
			{#if sampleFailed}
				<p class="note" role="status">Couldn’t load the sample just now. Try again in a moment.</p>
			{/if}
		</section>
	{:else}
		<section class="stack room">
			<h2 id="room-q">How much room today?</h2>
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

		<section class="stack cards" aria-label="For today" aria-live="polite">
			{#each cards as card (card.promptId)}
				<article class="card" class:thread={card.kind === 'thread'} out:fold in:soft>
					{#if card.kind === 'suggest_circle'}
						<p class="kicker">Someone who comes up a lot</p>
						<h2>Keep {card.title} close?</h2>
						<p class="reason">{card.reason}</p>
						<div class="actions">
							<button class="btn soft" type="button" onclick={() => answer(card, 'keep')}>Keep</button>
							<button class="btn quiet" type="button" onclick={() => answer(card, 'not_now')}>Not now</button>
						</div>
					{:else if card.kind === 'thread'}
						<p class="kicker">Yours</p>
						<h2>{card.title}</h2>
						{#if card.reason}<p class="reason">{card.reason}</p>{/if}
						<div class="actions">
							<button class="btn soft" type="button" onclick={() => answer(card, 'done')}>
								<Icon name="check" size={20} /> Done
							</button>
							<button class="btn quiet" type="button" onclick={() => answer(card, 'not_now')}>Not now</button>
						</div>
					{:else}
						{#if card.personId}
							<a class="name" href="/circle/{card.personId}"><h2>{card.title}</h2></a>
						{:else}
							<h2>{card.title}</h2>
						{/if}
						<p class="reason">{card.reason}</p>
						<div class="actions">
							<button class="btn soft" type="button" onclick={() => poke(card)}>Poke</button>
							<button class="btn" type="button" onclick={() => findTime(card)}>Find a time</button>
							<button class="btn quiet" type="button" onclick={() => answer(card, 'not_now')}>Not now</button>
						</div>
					{/if}
				</article>
			{/each}

			{#if loaded && cards.length === 0}
				<div class="empty" in:soft>
					{#if failed}
						<p class="calm">Today is still waking up.</p>
						<p class="muted">Your notes are safe. Try again in a moment.</p>
						<button class="btn" type="button" onclick={load}>Try again</button>
					{:else}
						<p class="calm">Nothing needs you today.</p>
						<p class="muted">Kizuna will speak up when there’s a good reason.</p>
					{/if}
				</div>
			{/if}
		</section>

		<a href="/threads" class="card link-row">
			<Icon name="threads" />
			<span>Your threads</span>
			<span class="sub muted">ideas, plans, promises, errands</span>
			<Icon name="chevron" size={20} />
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
	.top {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 12px;
		padding-top: 8px;
	}
	.top .icon-btn {
		margin-right: -10px;
	}
	.welcome {
		gap: 14px;
		padding: 24px 20px 20px;
	}
	.welcome h2 {
		font-size: 1.3125rem;
		line-height: 1.35;
	}
	.room {
		gap: 10px;
	}
	.room h2 {
		font-size: 1rem;
		color: var(--text-2);
		font-weight: 560;
	}
	.cards {
		gap: 14px;
	}
	.kicker {
		font-size: 0.8125rem;
		font-weight: 600;
		letter-spacing: 0.04em;
		color: var(--text-3);
	}
	.card h2 {
		font-size: 1.25rem;
	}
	.card.thread {
		background: var(--surface-2);
		box-shadow: none;
		border-color: transparent;
	}
	.name {
		color: inherit;
		text-decoration: none;
		align-self: flex-start;
	}
	.empty {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 6px;
		padding: 28px 4px 8px;
	}
	.empty .btn {
		margin-top: 10px;
	}
	.calm {
		font-size: 1.375rem;
		font-weight: 620;
		line-height: 1.3;
	}
	.link-row {
		display: grid;
		grid-template-columns: auto 1fr auto;
		grid-template-areas: 'i t c' 'i s c';
		align-items: center;
		column-gap: 14px;
		row-gap: 0;
		padding: 14px 16px;
		box-shadow: none;
	}
	.link-row > :global(svg:first-child) {
		grid-area: i;
		color: var(--text-2);
	}
	.link-row > span:first-of-type {
		grid-area: t;
		font-weight: 600;
	}
	.link-row .sub {
		grid-area: s;
		font-size: 0.875rem;
	}
	.link-row > :global(svg:last-child) {
		grid-area: c;
		color: var(--text-3);
	}
</style>
