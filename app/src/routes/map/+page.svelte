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

	const view = watch<MapView | undefined>(() => mapLive(), undefined);
	const settings = watch<Settings | undefined>(() => settingsLive(), undefined);
	const people = watch<Person[]>(() => allPeople(), []);
	const byId = $derived(new Map(people.value.map((p) => [p.id, p])));

	const hasCircle = $derived(!!settings.value?.circle);
	const occasions = $derived((view.value?.occasions ?? []).slice(0, 3));

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

<div class="page">
	<div class="head">
		<p class="label">The Kizuna map</p>
		<h1>Who’s <em>open</em> to a call</h1>
	</div>

	{#if occasions.length}
		<section class="strip" aria-label="This weekend">
			<span class="label">Coming up</span>
			<ul>
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
		</section>
	{/if}

	{#if view.value}
		<Constellation people={view.value.people} me={{ name: 'You', localTime: view.value.me.localTime }} />
		{#if view.value.people.length}
			<p class="legend tiny">
				<span><i class="g" aria-hidden="true"></i> glow: open to a call</span>
				<span><i class="n" aria-hidden="true"></i> shaded: night there</span>
			</p>
		{/if}
		{#if hasCircle && !view.value.sharing}
			<p class="note">
				You’re not sharing right now, so nobody’s glow shows here. <a href="/settings#map">Sharing settings</a>
			</p>
		{/if}
	{:else if view.ready}
		<p class="note">The map is still waking up.</p>
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

<style>
	.head h1 {
		max-width: 12ch;
	}
	.strip {
		display: flex;
		flex-direction: column;
		gap: 8px;
		margin-top: -6px;
	}
	.strip ul {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
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
		fill: var(--seal);
	}
	.legend {
		display: flex;
		justify-content: center;
		flex-wrap: wrap;
		gap: 4px 18px;
		margin-top: -14px;
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
		background: #f4c46c;
		box-shadow: 0 0 0 4px rgb(244 196 108 / 0.35);
	}
	.legend .n {
		background: linear-gradient(90deg, #9cc6ee 50%, color-mix(in srgb, #9cc6ee 38%, var(--bg)) 50%);
		box-shadow: inset 0 0 0 0.75px var(--text-3);
	}
	.cards {
		display: flex;
		flex-direction: column;
	}
	.cards:empty {
		display: none;
	}
	.invite {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 10px;
		padding-top: 14px;
		border-top: 2px solid var(--rule);
	}
	.invite .btn {
		margin-top: 6px;
	}
	.privacy {
		text-align: center;
	}
</style>
