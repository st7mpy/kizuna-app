<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import type { GiftCard as Gift, Person, Settings, WeekendCard as Weekend } from '@kizuna/shared';
	import {
		SAMPLE_CIRCLE_ID,
		addMemberAsPerson,
		freshAnswerPeople,
		giftCards,
		inviteFamilyLine,
		linkMember,
		markInvited,
		refreshCircle,
		refreshSampleMembers,
		weekendCard
	} from '#lib/core/index.js';
	import { allPeople, circleMembers, mapLive, settingsLive, type MapView, type MemberRow } from '#lib/db.js';
	import { shareAfter, shareWithToast } from '#lib/ui/toast.svelte.js';
	import Sheet from '#lib/ui/Sheet.svelte';
	import { watch } from '#lib/ui/live.svelte.js';
	import { occasionChip } from '#lib/ui/mapformat.js';
	import { fold, soft } from '#lib/ui/motion.js';
	import Constellation from '#lib/ui/Constellation.svelte';
	import WeekendCard from '#lib/ui/WeekendCard.svelte';
	import Hint from '#lib/ui/Hint.svelte';
	import { passTour, tour } from '#lib/ui/tour.svelte.js';
	import GiftCard from '#lib/ui/GiftCard.svelte';
	import MemberList from '#lib/ui/MemberList.svelte';
	import { hueOf } from '#lib/ui/hue.js';
	import { initials } from '#lib/ui/mapformat.js';

	const view = watch<MapView | undefined>(() => mapLive(), undefined);
	const settings = watch<Settings | undefined>(() => settingsLive(), undefined);
	const people = watch<Person[]>(() => allPeople(), []);
	const byId = $derived(new Map(people.value.map((p) => [p.id, p])));

	const hasCircle = $derived(!!settings.value?.circle);
	const isSample = $derived(settings.value?.circle?.id === SAMPLE_CIRCLE_ID);
	const ownCircle = $derived(hasCircle && !isSample);
	const occasions = $derived((view.value?.occasions ?? []).slice(0, 3));
	const mapPeople = $derived(view.value?.people ?? []);
	const circleName = $derived(hasCircle ? 'Family circle' : 'Your circle');

	let weekend = $state<Weekend | null>(null);
	// Goes up after each refresh, so a faint light travels along the map's lines.
	let beat = $state(0);
	let gifts = $state<Gift[]>([]);

	// Someone answered on the family page since the map was last open: light them up.
	const members = watch<MemberRow[]>(() => circleMembers(), []);
	const SEEN = 'kizuna:map-seen';
	let seenAt: string | null = null;
	try {
		seenAt = localStorage.getItem(SEEN);
	} catch {
		/* no storage: light everyone who answered */
	}
	let lit = $state<string[]>([]);
	$effect(() => {
		if (!members.ready) return;
		const fresh = freshAnswerPeople(members.value, seenAt);
		if (!fresh.length) return;
		lit = fresh;
		seenAt = new Date().toISOString();
		try {
			localStorage.setItem(SEEN, seenAt);
		} catch {
			/* fine */
		}
	});

	// Until the first look at this weekend is back, a quiet line holds its place.
	let checking = $state(true);
	async function loadCards() {
		try {
			const [w, g] = await Promise.all([weekendCard(), giftCards()]);
			weekend = w;
			gifts = g;
		} catch {
			/* the map still shows */
		} finally {
			checking = false;
		}
	}

	// Re-fetch the circle when the map opens and every minute while it is open. A sample family's
	// answers move along with the clock, so it still glows days after it was loaded.
	onMount(() => {
		const sync = () =>
			Promise.all([refreshCircle().catch(() => {}), refreshSampleMembers().catch(() => false)]).finally(() => beat++);
		void sync().then(loadCards);
		const t = setInterval(sync, 60_000);
		return () => clearInterval(t);
	});

	// Someone answered on the family page (not the sample's family): the invite card can step back.
	const replied = $derived(members.value.some((m) => !m.memberId.startsWith('sample-')));
	// With a circle of my own, the line is ready before the tap, so sharing starts on the tap itself.
	let ready = $state<{ line: string; invitees: string[] } | null>(null);
	$effect(() => {
		if (!ownCircle) {
			ready = null;
			return;
		}
		const id = settings.value?.circle?.id;
		void inviteFamilyLine()
			.then((r) => {
				if (settings.value?.circle?.id === id) ready = r;
			})
			.catch(() => {});
	});

	let inviting = $state(false);
	let inviteNote = $state('');
	async function invite() {
		inviteNote = '';
		const now = ready;
		if (now) {
			// no await before this: the share sheet or WhatsApp opens on the tap
			const r = await shareWithToast(now.line);
			if (r === 'blocked') inviteNote = 'Your browser stopped WhatsApp from opening. Tap again to send it.';
			else if (r !== 'cancelled') await markInvited(now.invitees).catch(() => {});
			return;
		}
		inviting = true;
		try {
			let made: { line: string; invitees: string[] } | null = null;
			const r = await shareAfter(async () => {
				made = await inviteFamilyLine();
				return made.line;
			});
			if (made) ready = made;
			if (r === 'blocked') inviteNote = 'Your link is ready. Tap Share the link to send it.';
			else if (r !== 'cancelled' && made) await markInvited((made as { invitees: string[] }).invitees).catch(() => {});
		} catch {
			inviteNote = 'Couldn’t make the link just now. Try again in a moment.';
		} finally {
			inviting = false;
		}
	}

	// "Who is this?": someone answered on the family page and isn't linked to anyone here.
	const whoId = $derived(page.url.searchParams.get('who'));
	const who = $derived(whoId ? members.value.find((m) => m.memberId === whoId) : undefined);
	const whoOpen = $derived(!!who);
	const pickable = $derived(people.value.filter((p) => p.circle !== 'out').sort((a, b) => a.name.localeCompare(b.name)));
	let whoPick = $state('');
	let whoNote = $state('');
	let whoBusy = $state(false);
	const closeWho = () => {
		whoPick = '';
		whoNote = '';
		if (whoId) void goto('/map', { replace: true, reset: false });
	};
	async function whoDo(act: () => Promise<unknown>) {
		whoBusy = true;
		whoNote = '';
		try {
			await act();
			closeWho();
		} catch {
			whoNote = 'Couldn’t save that just now. Try again in a moment.';
		} finally {
			whoBusy = false;
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
							<span class="face" style="--hue:{hueOf(m)}">{initials(m.person.name).slice(0, 1)}</span>
						{/each}
					</span>
					<span>{circleName}{#if mapPeople.length}&nbsp;<span class="num">· {mapPeople.length}</span>{/if}</span>
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
				{#if tour.step === 1 && view.value.people.length}<Hint text="See who’s free: glowing dots can talk now" onpass={() => passTour(1)} />{/if}
				<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
				<div class="stage" onclick={() => passTour(1)}>
					<Constellation people={view.value.people} me={{ name: 'You', localTime: view.value.me.localTime }} {beat} {lit} />
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
				{#if checking && !weekend && mapPeople.length}
					<p class="checking tiny" out:fold>Checking this weekend…</p>
				{/if}
				{#if weekend}
					<div out:fold in:soft>
						<WeekendCard card={weekend} people={byId} zoneOf={(id) => mapPeople.find((m) => m.person.id === id)?.tz} ondismiss={() => (weekend = null)} />
					</div>
				{/if}
				{#each gifts as g (g.hint.id)}
					<div out:fold in:soft>
						<GiftCard card={g} people={byId} ondismiss={() => (gifts = gifts.filter((x) => x.hint.id !== g.hint.id))} />
					</div>
				{/each}
			</section>

			{#if settings.ready && !(ownCircle && replied)}
				<section class="invite" in:soft aria-label="Family link">
					{#if ownCircle}
						<p class="label">Waiting for replies</p>
						<p class="muted">Your family link is out. When someone taps a time, their dot lights up here.</p>
						<button class="btn line" type="button" onclick={invite} disabled={inviting}>Share the link again</button>
					{:else}
						{#if isSample}<p class="label">This is a sample family</p>{/if}
						<p class="calm">{isSample ? 'Try it with your own family.' : 'Ask the family about this weekend.'}</p>
						<p class="muted">
							One link in the family group. They tap when they’re free, no app needed, and their dots light up here.
						</p>
						<button class="btn primary big" type="button" onclick={invite} disabled={inviting}>
							{inviting ? 'Making the link…' : ready ? 'Share the link' : 'Share the family link'}
						</button>
					{/if}
					{#if inviteNote}<p class="note" role="alert">{inviteNote}</p>{/if}
				</section>
			{/if}

			<p class="privacy tiny">No location. Only free windows you choose to share.</p>
		</div>
	</div>
</div>

<Sheet open={whoOpen} title="Who is" em="{who?.entry.name ?? 'this'}?" onclose={closeWho}>
	{#if who}
		<p class="muted">
			{who.entry.name} answered on the family page{who.reply ? `: “${who.reply}”` : '.'} Link them to someone in your circle so their dot
			and times show with that person.
		</p>
		{#if pickable.length}
			<div class="row who-pick">
				<label class="field grow">
					<span class="sr-only">Who {who.entry.name} is</span>
					<select bind:value={whoPick}>
						<option value="">Pick someone…</option>
						{#each pickable as p (p.id)}
							<option value={p.id}>{p.name}</option>
						{/each}
					</select>
				</label>
				<button class="btn line" type="button" disabled={!whoPick || whoBusy} onclick={() => whoDo(() => linkMember(who.memberId, whoPick))}>
					Link
				</button>
			</div>
		{/if}
		<button class="btn primary big block" type="button" disabled={whoBusy} onclick={() => whoDo(() => addMemberAsPerson(who.memberId))}>
			Add {who.entry.name} to your circle
		</button>
		<button class="btn quiet block" type="button" disabled={whoBusy} onclick={() => whoDo(() => linkMember(who.memberId, null))}>
			Not someone I know
		</button>
		{#if whoNote}<p class="note" role="alert">{whoNote}</p>{/if}
	{/if}
</Sheet>

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
		box-shadow: 0 0 0 2px var(--surface-solid);
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
			--map-w: 560px;
			--map-max-h: calc(100dvh - 330px);
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
		background: radial-gradient(circle at 42% 38%, #fffdf8, #ecc489 60%);
		box-shadow: 0 0 0 4px var(--glow), 0 0 10px 4px var(--glow);
	}
	.legend .n {
		background: linear-gradient(90deg, #a4c6e8 50%, color-mix(in srgb, #a4c6e8 38%, var(--bg)) 50%);
		box-shadow: inset 0 0 0 0.75px var(--text-3);
	}
	/* The map floats straight on the sky, like the landing's tree: no frame. */
	.stage {
		position: relative;
		display: flex;
		flex-direction: column;
		gap: 14px;
		padding: 20px 0 6px;
	}
	.legend {
		font-size: 0.6875rem;
		font-weight: 500;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: var(--text-3);
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
	.checking {
		padding: 6px 4px;
	}
	.who-pick {
		align-items: flex-end;
		gap: 10px;
	}
	select {
		appearance: auto;
	}
	/* A short phone: the heading and chips take less room, so the map isn't cut by the tab bar. */
	@media (max-width: 719px) and (max-height: 700px) {
		.head :global(.label) {
			display: none;
		}
		.head h1 {
			max-width: none;
			font-size: clamp(1.5rem, 7vw, 1.875rem);
		}
		.pillrow {
			flex-wrap: nowrap;
			overflow-x: auto;
			scrollbar-width: none;
			margin-right: calc(-1 * var(--gutter));
			padding-right: var(--gutter);
		}
		.pillrow::-webkit-scrollbar {
			display: none;
		}
		.pill,
		.strip .tag {
			flex: none;
		}
		.stage {
			padding-top: 8px;
		}
	}
</style>
