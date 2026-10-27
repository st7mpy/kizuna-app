<script lang="ts">
	import { onMount } from 'svelte';
	import { liveQuery } from 'dexie';
	import type { Card, GiftCard as Gift, Person, Room, Settings, WeekendCard as Weekend } from '@kizuna/shared';
	import {
		answerCard,
		answerLines,
		dismissAnswer,
		draftNudge,
		followUps,
		markNudged,
		setRoom,
		todayCards,
		todayExtras,
		type AnswerLine,
		type FollowUp
	} from '#lib/core/index.js';
	import DraftBox from '#lib/ui/DraftBox.svelte';
	import { allPeople, db, hasAnyData, settingsLive } from '#lib/db.js';
	import { watch } from '#lib/ui/live.svelte.js';
	import { dayKey, greeting } from '#lib/ui/format.js';
	import { fold, soft } from '#lib/ui/motion.js';
	import Segmented from '#lib/ui/Segmented.svelte';
	import PokeSheet from '#lib/ui/PokeSheet.svelte';
	import TimeSheet from '#lib/ui/TimeSheet.svelte';
	import Icon from '#lib/ui/Icon.svelte';
	import { hueFor } from '#lib/ui/hue.js';
	import WeekendCard from '#lib/ui/WeekendCard.svelte';
	import GiftCard from '#lib/ui/GiftCard.svelte';
	import Landing from '#lib/landing/Landing.svelte';
	import { hasEntered } from '#lib/landing/entered.js';
	import Constellation from '#lib/ui/Constellation.svelte';
	import { screen } from '#lib/ui/screen.svelte.js';
	import { mapLive, type MapView } from '#lib/db.js';
	import { occasionChip } from '#lib/ui/mapformat.js';

	const settings = watch<Settings | undefined>(() => settingsLive(), undefined);
	const hasData = watch(() => hasAnyData(), false);
	const people = watch<Person[]>(() => allPeople(), []);
	// The side column on a wide screen: a small map and what's coming up.
	const map = watch<MapView | undefined>(() => mapLive(), undefined);
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

	// Closing the loop: who answered the family page, and who hasn't yet (a line the user sends).
	const answers = watch<AnswerLine[]>(() => liveQuery(() => answerLines()), []);
	const waiting = watch<FollowUp[]>(() => liveQuery(() => followUps()), []);
	let nudging = $state<string | null>(null);

	let cards: Card[] = $state([]);
	let weekend = $state<Weekend | null>(null);
	let gifts = $state<Gift[]>([]);
	let loaded = $state(false);
	let failed = $state(false);

	const now = new Date();
	// A sample family lives in its own city: greet and date in that zone, not the visitor's.
	const homeTz = $derived(settings.value?.homeTz || undefined);
	const hello = $derived(greeting(Number(now.toLocaleTimeString('en-GB', { hour: '2-digit', hour12: false, timeZone: homeTz }).slice(0, 2)) % 24));
	const myName = $derived(settings.value?.myName?.trim() ?? '');
	const dateLine = $derived(now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: homeTz }));
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
		// The weekend plan and gift ideas sit above the person cards; quiet if they fail.
		try {
			const extras = await todayExtras();
			weekend = extras.weekend;
			gifts = extras.gifts;
		} catch {
			/* nothing extra today */
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

	// A first visit with nothing on this device sees the landing page, until they step inside.
	const entered = hasEntered();
	const firstRun = $derived(hasData.ready && !hasData.value && !entered);
	// Stays up while the sample family loads, so Today doesn't flash before the map opens.
	let landing = $state(false);
	$effect(() => {
		if (firstRun) landing = true;
	});
</script>

<svelte:head><title>{firstRun || landing ? 'Kizuna: know when your people are free to talk' : 'Today · Kizuna'}</title></svelte:head>

{#if !hasData.ready && !entered}
	<!-- a moment while we check this device for notes -->
{:else if firstRun || landing}
	<Landing />
{:else}
<div class="page" class:wide={!firstRun}>
		<div class="head">
			<p class="label">{dateLine}</p>
			<h1>{hello}{#if myName},<br /><em>{myName}</em>{/if}</h1>
		</div>

		<div class="panes today">
		<div class="main">
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

		{#if answers.value.length || waiting.value.length}
			<section class="loop" aria-label="Family call answers" aria-live="polite">
				{#each answers.value as a (a.memberId)}
					<div class="loopline" out:fold in:soft>
						<span class="dot" style="--hue:{hueFor(a.personId ?? a.memberId)}" aria-hidden="true"></span>
						<p class="said"><strong>{a.name}</strong> answered: {a.words}</p>
						<button class="icon-btn bare close" type="button" aria-label="Close: {a.text}" onclick={() => dismissAnswer(a.memberId)}>
							<Icon name="close" size={18} />
						</button>
					</div>
				{/each}
				{#each waiting.value as f (f.personId)}
					<div class="loopline wait" out:fold in:soft>
						<span class="dot" style="--hue:{hueFor(f.personId)}" aria-hidden="true"></span>
						<p class="said"><strong>{f.name}</strong> hasn’t answered yet</p>
						{#if nudging !== f.personId}
							<button class="btn accent nudge" type="button" onclick={() => (nudging = f.personId)}>Draft a nudge</button>
						{/if}
					</div>
					{#if nudging === f.personId}
						<div class="nudgebox">
							<DraftBox
								label="For {f.name}"
								phone={f.phone}
								share={!f.phone}
								load={() => draftNudge(f.personId)}
								onopened={() => {
									nudging = null;
									markNudged(f.personId).catch(() => {});
								}}
								oncancel={() => (nudging = null)}
							/>
						</div>
					{/if}
				{/each}
			</section>
		{/if}

		{#if weekend || gifts.length}
			<section class="extras" aria-label="This weekend">
				{#if weekend}
					<div out:fold in:soft>
						<WeekendCard card={weekend} people={byId} ondismiss={() => (weekend = null)} />
					</div>
				{/if}
				{#each gifts as g (g.hint.id)}
					<div out:fold in:soft>
						<GiftCard card={g} people={byId} ondismiss={() => (gifts = gifts.filter((x) => x.hint.id !== g.hint.id))} />
					</div>
				{/each}
			</section>
		{/if}

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

			{#if loaded && cards.length === 0 && !weekend && !gifts.length}
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
		</div>
		{#if screen.wide}
			<aside class="side" aria-label="Your map">
				{#if map.value?.people.length}
					<section class="mini">
						<div class="spread">
							<h3>Your map</h3>
							<a href="/map" class="btn accent small-link">Open the map</a>
						</div>
						<Constellation people={map.value.people} me={{ name: 'You', localTime: map.value.me.localTime }} />
					</section>
				{/if}
				{#if map.value?.occasions.length}
					<section class="section">
						<h3>Coming up</h3>
						<ul class="rows">
							{#each map.value.occasions.slice(0, 4) as o (o.day + o.name)}
								<li class="soon">{occasionChip(o.name, o.day)}</li>
							{/each}
						</ul>
					</section>
				{/if}
			</aside>
		{/if}
		</div>
</div>
{/if}

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
	.room {
		display: flex;
		flex-direction: column;
		gap: 10px;
		margin-top: -4px;
	}
	.extras {
		display: flex;
		flex-direction: column;
		gap: 14px;
		margin-top: -4px;
	}
	.loop {
		display: flex;
		flex-direction: column;
		gap: 2px;
		margin-top: -10px;
		padding: 6px 8px 6px 18px;
		border-radius: var(--r-card);
		background: var(--surface);
		-webkit-backdrop-filter: var(--blur);
		backdrop-filter: var(--blur);
		box-shadow: var(--card-shadow);
	}
	.loopline {
		display: flex;
		align-items: center;
		gap: 12px;
		min-height: 52px;
	}
	.loopline + .loopline {
		border-top: 1px solid var(--line);
	}
	.loopline .dot {
		flex: none;
		width: 10px;
		height: 10px;
	}
	.said {
		flex: 1;
		min-width: 0;
		color: var(--text-2);
	}
	.said strong {
		font-weight: 500;
		color: var(--text);
	}
	.close {
		flex: none;
		color: var(--text-3);
	}
	.nudge {
		flex: none;
		min-height: 44px;
		padding-right: 10px;
	}
	.nudgebox {
		padding: 0 10px 12px 0;
	}
	.moments {
		display: flex;
		flex-direction: column;
		gap: 14px;
	}
	.moment {
		display: flex;
		flex-direction: column;
		gap: 6px;
		padding: 20px 20px 10px;
		border-radius: var(--r-card);
		background: var(--surface);
		-webkit-backdrop-filter: var(--blur);
		backdrop-filter: var(--blur);
		box-shadow: var(--card-shadow);
	}
	.moment.thread {
		background: var(--bg-2);
		box-shadow: inset 0 0 0 1px var(--line);
	}
	.who {
		display: flex;
		align-items: center;
		gap: 12px;
		font-size: 1.5rem;
		line-height: 1.15;
		letter-spacing: -0.03em;
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
		font-size: 1.3125rem;
		line-height: 1.25;
		letter-spacing: -0.025em;
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
		padding: 18px 16px 18px 22px;
		border-radius: var(--r-card);
		background: var(--bg-2);
		-webkit-backdrop-filter: var(--blur);
		backdrop-filter: var(--blur);
		box-shadow: inset 0 0 0 1px var(--line);
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
		font-size: var(--t-small);
	}
	.threads .icon-btn {
		grid-area: i;
	}
	.threads:focus-visible {
		outline-offset: 4px;
	}
	.today > .main {
		gap: 28px;
	}
	.mini {
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 18px 20px 16px;
		border-radius: var(--r-card);
		background: var(--surface);
		-webkit-backdrop-filter: var(--blur);
		backdrop-filter: var(--blur);
		box-shadow: var(--card-shadow);
		--map-w: 360px;
	}
	.small-link {
		min-height: 36px;
		font-size: var(--t-small);
	}
	.soon {
		padding: 12px 0;
		font-size: var(--t-small);
	}
	@media (min-width: 720px) {
		.reason {
			max-width: 52ch;
		}
		.moment {
			padding: 24px 26px 12px;
		}
	}
</style>
