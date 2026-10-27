<script lang="ts">
	import { onMount } from 'svelte';
	import type { GiftCard as Gift, Person, Settings, WeekendCard as Weekend } from '@kizuna/shared';
	import { giftCards, inviteFamilyLine, refreshCircle, weekendCard } from '#lib/core/index.js';
	import { allPeople, mapLive, settingsLive, type MapView } from '#lib/db.js';
	import { watch } from '#lib/ui/live.svelte.js';
	import { occasionChip } from '#lib/ui/mapformat.js';
	import { fold, soft } from '#lib/ui/motion.js';
	import Constellation from '#lib/ui/Constellation.svelte';
	import WeekendCard from '#lib/ui/WeekendCard.svelte';
	import GiftCard from '#lib/ui/GiftCard.svelte';
	import MemberList from '#lib/ui/MemberList.svelte';
	import { hueFor } from '#lib/ui/hue.js';
	import { initials } from '#lib/ui/mapformat.js';

	const view = watch<MapView | undefined>(() => mapLive(), undefined);
	const settings = watch<Settings | undefined>(() => settingsLive(), undefined);
	const people = watch<Person[]>(() => allPeople(), []);
	const byId = $derived(new Map(people.value.map((p) => [p.id, p])));

	const hasCircle = $derived(!!settings.value?.circle);
	const occasions = $derived((view.value?.occasions ?? []).slice(0, 3));
	const mapPeople = $derived(view.value?.people ?? []);
	const circleName = $derived(hasCircle ? 'Family circle' : 'Your circle');

	let weekend = $state<Weekend | null>(null);
	let gifts = $state<Gift[]>([]);

	async function loadCards() {
		try {
			const [w, g] = await Promise.all([weekendCard(), giftCards()]);
			weekend = w;
			gifts = g;
		} catch {
			/* the map still shows */
		}
	}

	// Re-fetch the circle when the map opens and every minute while it is open.
	onMount(() => {
		const sync = () => refreshCircle().catch(() => {});
		void sync().then(loadCards);
		void loadCards();
		const t = setInterval(sync, 60_000);
		return () => clearInterval(t);
	});

	let inviting = $state(false);
	let inviteNote = $state('');
	async function invite() {
		inviting = true;
		inviteNote = '';
		try {
			const { link } = await inviteFamilyLine();
			window.open(link, '_blank', 'noopener');
		} catch {
			inviteNote = 'Couldn’t make the link just now. Try again in a moment.';
		} finally {
			inviting = false;
		}
	}
</script>

<svelte:head><title>Map · Kizuna</title></svelte:head>

<div class="page wide">
	<div class="panes">
		<div class="main">
			<div class="head">
				<p class="label">The Kizuna map</p>
				<h1>Who’s <em>open</em> to a call</h1>
			</div>

			<div class="pillrow">
				<a class="pill" href="/circle" aria-label="{circleName}, {mapPeople.length} people. Open your circle">
					<span class="faces" aria-hidden="true">
						{#each mapPeople.slice(0, 3) as m (m.person.id)}
							<span class="face" style="--hue:{hueFor(m.person.id)}">{initials(m.person.name).slice(0, 1)}</span>
						{/each}
					</span>
					<span>{circleName}&nbsp;<span class="num">· {mapPeople.length}</span></span>
				</a>
				{#if occasions.length}
					<ul class="strip" aria-label="Coming up">
						{#each occasions as o (o.day + o.name)}
							<li class="tag">
								<svg width="12" height="12" viewBox="-6 -7 12 12" aria-hidden="true">
									{#if o.kind === 'birthday'}
										<rect x="-4.5" y="-1" width="9" height="5" rx="1" class="ink" />
										<circle cx="0" cy="-4" r="1.5" class="flame" />
									{:else}
										<path d="M-5 0 Q0 5 5 0 Z" class="ink" />
										<path d="M0 -1 Q-2.2 -3.4 0 -6.6 Q2.2 -3.4 0 -1 Z" class="flame" />
									{/if}
								</svg>
								{occasionChip(o.name, o.day)}
							</li>
						{/each}
					</ul>
				{/if}
			</div>

			{#if view.value}
				<div class="stage">
					<Constellation people={view.value.people} me={{ name: 'You', localTime: view.value.me.localTime }} />
					{#if view.value.people.length}
						<p class="legend tiny">
							<span><i class="g" aria-hidden="true"></i> glow: open to a call</span>
							<span><i class="n" aria-hidden="true"></i> shaded: night there</span>
						</p>
					{/if}
				</div>
				{#if hasCircle && !view.value.sharing}
					<p class="note">
						You’re not sharing right now, so nobody’s glow shows here. <a href="/settings#map">Sharing settings</a>
					</p>
				{/if}
			{:else if view.ready}
				<p class="note">The map is still waking up.</p>
			{/if}
		</div>

		<div class="side">
			{#if mapPeople.length}
				<MemberList people={mapPeople} title="On your map" />
			{/if}

			<section class="cards" aria-label="For this weekend" aria-live="polite">
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

			{#if settings.ready && !hasCircle}
				<section class="invite" in:soft>
					<p class="calm">Ask the family about <em>this weekend</em>.</p>
					<p class="muted">
						One link in the family group. They tap when they’re free, no app needed, and their dots light up here.
					</p>
					<button class="btn primary big" type="button" onclick={invite} disabled={inviting}>
						{inviting ? 'Making the link…' : 'Ask the family about this weekend'}
					</button>
					{#if inviteNote}<p class="note" role="alert">{inviteNote}</p>{/if}
				</section>
			{/if}

			<p class="privacy tiny">No location. Only free windows you choose to share.</p>
		</div>
	</div>
</div>

<style>
	.head h1 {
		max-width: 12ch;
	}
	.pillrow {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px;
		margin-top: -8px;
	}
	.pill {
		display: inline-flex;
		align-items: center;
		gap: 10px;
		min-height: 40px;
		padding: 4px 16px 4px 5px;
		border-radius: 999px;
		background: var(--surface);
		box-shadow: var(--card-shadow);
		color: var(--text);
		font-size: var(--t-small);
		font-weight: 500;
		text-decoration: none;
	}
	.pill .num {
		color: var(--text-3);
	}
	.faces {
		display: inline-flex;
	}
	.face {
		display: grid;
		place-items: center;
		width: 30px;
		height: 30px;
		border-radius: 50%;
		background: var(--hue);
		color: #141311;
		font-size: 0.75rem;
		font-weight: 600;
		box-shadow: 0 0 0 2px var(--surface);
	}
	.face + .face {
		margin-left: -6px;
	}
	.strip {
		display: contents;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.strip .tag {
		gap: 6px;
		min-height: 30px;
		padding: 2px 12px;
		font-size: 0.875rem;
	}
	.ink {
		fill: var(--text-2);
	}
	.flame {
		fill: #e39a62;
	}
	.legend {
		display: flex;
		justify-content: center;
		flex-wrap: wrap;
		gap: 4px 18px;
	}
	/* Beside the list, the constellation gets room to breathe. */
	@media (min-width: 1100px) {
		.stage {
			--map-w: 600px;
			padding: 40px 28px 22px;
		}
		.panes > .side {
			gap: 20px;
		}
	}
	.legend span {
		display: inline-flex;
		align-items: center;
		gap: 6px;
	}
	.legend i {
		display: inline-block;
		width: 10px;
		height: 10px;
		border-radius: 50%;
	}
	.legend .g {
		background: #e9b36f;
		box-shadow: 0 0 0 4px var(--glow);
	}
	.legend .n {
		background: linear-gradient(90deg, #a4c6e8 50%, color-mix(in srgb, #a4c6e8 38%, var(--bg)) 50%);
		box-shadow: inset 0 0 0 0.75px var(--text-3);
	}
	/* The map floats in a soft sky that follows the theme. */
	.stage {
		position: relative;
		display: flex;
		flex-direction: column;
		gap: 14px;
		padding: 28px 12px 18px;
		border-radius: 28px;
		background: var(--sky);
		box-shadow: inset 0 0 0 1px var(--line);
		overflow: hidden;
	}
	.cards {
		display: flex;
		flex-direction: column;
		gap: 14px;
	}
	.cards:empty {
		display: none;
	}
	.invite {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 10px;
		padding: 22px 22px 20px;
		border-radius: var(--r-card);
		background: var(--surface);
		box-shadow: var(--card-shadow);
	}
	.invite .btn {
		margin-top: 6px;
	}
	.privacy {
		text-align: center;
	}
</style>
