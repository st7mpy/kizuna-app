<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import type { Fragment, GiftHint, KEvent, Person } from '@kizuna/shared';
	import {
		invitePersonLine,
		linkMember,
		markInvited,
		mergePeople,
		noteThought,
		removePerson,
		retryFragment,
		updatePerson
	} from '#lib/core/index.js';
	import {
		allPeople,
		circleMembers,
		eventsFor,
		fragmentsMentioning,
		giftsFor,
		mapLive,
		person,
		type MapView,
		type MemberRow
	} from '#lib/db.js';
	import { cityOf } from '#lib/ui/constellation.js';
	import { occasionChip, whenLocal, yourTime } from '#lib/ui/mapformat.js';
	import { watch } from '#lib/ui/live.svelte.js';
	import { dayKey, dayLabel, noteDay, snippet } from '#lib/ui/format.js';
	import PokeSheet from '#lib/ui/PokeSheet.svelte';
	import TimeSheet from '#lib/ui/TimeSheet.svelte';
	import Sheet from '#lib/ui/Sheet.svelte';
	import Icon from '#lib/ui/Icon.svelte';
	import { hueFor } from '#lib/ui/hue.js';
	import { shareWithToast } from '#lib/ui/toast.svelte.js';

	const id = $derived(page.params.id ?? '');
	const p = watch<Person | undefined>(() => person(id), undefined);
	const events = watch<KEvent[]>(() => eventsFor(id), []);
	const notes = watch<Fragment[]>(() => fragmentsMentioning(id), []);
	const everyone = watch<Person[]>(() => allPeople(), []);

	const map = watch<MapView | undefined>(() => mapLive(), undefined);
	const gifts = watch<GiftHint[]>(() => giftsFor(id), []);
	const members = watch<MemberRow[]>(() => circleMembers(), []);
	const onMap = $derived(map.value?.people.find((m) => m.person.id === id));
	const openGift = $derived(gifts.value.find((g) => g.status === 'open'));
	const linked = $derived(members.value.find((m) => m.personId === id));
	const unlinked = $derived(members.value.filter((m) => !m.personId));
	const windowLine = (w: { start: string; end: string }) =>
		`${whenLocal(w.start)} to ${whenLocal(w.end).split(' ')[1]}`;

	// their own family-page link: greets them by name, so they never type it
	let asking = $state(false);
	let askNote = $state('');
	async function askWeekend() {
		if (!p.value) return;
		asking = true;
		askNote = '';
		try {
			const { line, link, phone } = await invitePersonLine(p.value.id);
			if (phone) window.open(link, '_blank', 'noopener');
			else if ((await shareWithToast(line, `a chat with ${p.value.name}`)) === 'cancelled') return;
			await markInvited([p.value.id]);
			askNote = `Their own link greets ${p.value.name} by name.`;
		} catch {
			askNote = 'Couldn’t make the link just now. Try again in a moment.';
		} finally {
			asking = false;
		}
	}

	// note a thought: stays on this phone
	let thought = $state('');
	let thoughtNote = $state('');
	let thinking = $state(false);
	async function saveThought(e: SubmitEvent) {
		e.preventDefault();
		const t = thought.trim();
		if (!t || !p.value) return;
		thinking = true;
		try {
			await noteThought(p.value.id, t);
			thought = '';
			thoughtNote = 'Kept. Only on this phone.';
		} catch {
			thoughtNote = 'Couldn’t keep that just now. Try again in a moment.';
		} finally {
			thinking = false;
		}
	}

	// link a family-page member to this person
	let memberPick = $state('');
	let linkNote = $state('');
	async function link(memberId: string | null) {
		linkNote = '';
		try {
			if (memberId) await linkMember(memberId, id);
			else if (linked) await linkMember(linked.memberId, null);
			memberPick = '';
		} catch {
			linkNote = 'Couldn’t link that just now.';
		}
	}

	const today = dayKey();
	const upcoming = $derived(
		events.value
			.filter((e) => e.day && e.day >= today)
			.sort((a, b) => (a.day ?? '').localeCompare(b.day ?? ''))
			.slice(0, 4)
	);
	const recent = $derived(notes.value.slice(0, 5));
	const others = $derived(everyone.value.filter((o) => o.id !== id && o.circle !== 'out'));

	const RELATION: Record<string, string> = {
		parent: 'Family',
		sibling: 'Family',
		partner: 'Partner',
		child: 'Family',
		family: 'Family',
		friend: 'Friend',
		colleague: 'Work'
	};
	const monthOf = (day: string) =>
		new Date(`${day}T12:00:00`).toLocaleDateString('en-GB', { month: 'short' });

	let retrying = $state<string | null>(null);
	async function retry(id: string) {
		retrying = id;
		try {
			await retryFragment(id);
		} catch {
			/* kept; Kizuna tries again later */
		} finally {
			retrying = null;
		}
	}

	let pokeOpen = $state(false);
	let timeOpen = $state(false);

	// details
	let name = $state('');
	let phone = $state('');
	let detailsFor = '';
	$effect(() => {
		if (p.value && detailsFor !== p.value.id) {
			detailsFor = p.value.id;
			name = p.value.name;
			phone = p.value.phone ?? '';
		}
	});
	let savedNote = $state('');
	const changed = $derived(!!p.value && (name.trim() !== p.value.name || phone.trim() !== (p.value.phone ?? '')));

	async function saveDetails(e: SubmitEvent) {
		e.preventDefault();
		if (!p.value || !name.trim()) return;
		const digits = phone.replace(/\D/g, '');
		try {
			await updatePerson(p.value.id, { name: name.trim(), phone: digits || undefined });
			phone = digits;
			savedNote = 'Saved.';
		} catch {
			savedNote = 'Couldn’t save that just now.';
		}
	}

	// merge and remove
	let mergeId = $state('');
	let mergeOpen = $state(false);
	let removeOpen = $state(false);
	let busy = $state(false);
	const mergeName = $derived(others.find((o) => o.id === mergeId)?.name ?? '');

	async function doMerge() {
		if (!p.value || !mergeId) return;
		busy = true;
		try {
			await mergePeople(p.value.id, mergeId);
			mergeOpen = false;
			mergeId = '';
		} finally {
			busy = false;
		}
	}
	async function doRemove() {
		if (!p.value) return;
		busy = true;
		try {
			await removePerson(p.value.id);
			removeOpen = false;
			goto('/circle');
		} finally {
			busy = false;
		}
	}
</script>

<svelte:head><title>{p.value?.name ?? 'Person'} · Kizuna</title></svelte:head>

<div class="page">
	<a href="/circle" class="back"><Icon name="back" size={18} /> Circle</a>

	{#if p.value}
		<div class="person-grid">
		<div class="lead">
		<section class="intro">
			<div class="window portrait" style="--hue:{hueFor(p.value.id)}">
				<p class="label">{RELATION[p.value.relation] ?? 'In your circle'}</p>
				<h1><em>{p.value.name}</em></h1>
			</div>
			{#if p.value.summary}<p class="summary">{p.value.summary}</p>{/if}
			<div class="row acts">
				<button class="btn primary big grow" type="button" onclick={() => (pokeOpen = true)}>
					<Icon name="send" size={20} /> Poke
				</button>
				<button class="btn line big grow" type="button" onclick={() => (timeOpen = true)}>
					<Icon name="clock" size={20} /> Find a time
				</button>
			</div>
			<button class="btn ask" type="button" onclick={askWeekend} disabled={asking}>
				<Icon name="calendar" size={18} />
				{asking ? 'Making their link…' : `Ask ${p.value.name} about this weekend`}
			</button>
			{#if askNote}<p class="tiny ask-note" role="status">{askNote}</p>{/if}
		</section>

		<section class="section">
			<h3>Note a thought</h3>
			<form class="stack thought" onsubmit={saveThought}>
				<label class="field">
					<span class="sr-only">A thought about {p.value.name}</span>
					<textarea
						rows="2"
						bind:value={thought}
						maxlength="1000"
						placeholder="Something to remember about {p.value.name}"
						oninput={() => (thoughtNote = '')}
					></textarea>
				</label>
				<div class="spread">
					<span class="tiny" role="status">{thoughtNote || 'Stays on this phone.'}</span>
					<button class="btn line" type="submit" disabled={!thought.trim() || thinking}>Keep</button>
				</div>
			</form>
		</section>
		</div>

		<div class="rest">
		{#if onMap && (onMap.localTime || onMap.windows.length || onMap.occasion || openGift)}
			<section class="section">
				<h3>On the map</h3>
				<ul class="rows">
					{#if onMap.localTime}
						<li class="map-row">
							<span class="label">Their time</span>
							<span
								><span class="num">{onMap.localTime}</span>{onMap.tz ? ` in ${cityOf(onMap.tz)}` : ''}{onMap.glow ===
								'open'
									? ', open to a call'
									: onMap.glow === 'maybe'
										? ', maybe later'
										: ''}</span
							>
						</li>
					{/if}
					{#if onMap.windows.length}
						<li class="map-row">
							<span class="label">Free this week, {yourTime()}</span>
							{#each onMap.windows as w (w.start)}<span class="num">{windowLine(w)}</span>{/each}
						</li>
					{/if}
					{#if onMap.occasion}
						<li class="map-row">
							<span class="label">Occasion</span>
							<span>{occasionChip(onMap.occasion.name, onMap.occasion.day)}</span>
						</li>
					{/if}
					{#if openGift}
						<li class="map-row">
							<span class="label">Gift idea, only on this phone</span>
							<span>{openGift.what}</span>
						</li>
					{/if}
				</ul>
			</section>
		{:else if openGift}
			<section class="section">
				<h3>Gift idea</h3>
				<p class="pad">{openGift.what} <span class="tiny">Only on this phone.</span></p>
			</section>
		{/if}

		{#if upcoming.length}
			<section class="section">
				<h3>Coming up</h3>
				<ul class="rows">
					{#each upcoming as e (e.id)}
						<li class="date-row">
							<span class="date">
								<span class="d num">{Number((e.day ?? today).slice(8))}</span>
								<span class="m">{monthOf(e.day ?? today)}</span>
							</span>
							<span class="what">
								<span class="label">{dayLabel(e.day ?? today, today)}{e.time ? `, ${e.time}` : ''}</span>
								<span>{e.what}</span>
							</span>
						</li>
					{/each}
				</ul>
			</section>
		{/if}

		<section class="section">
			<h3>From your notes</h3>
			{#if recent.length}
				<ul class="rows">
					{#each recent as f (f.id)}
						<li class="note-row">
							<span class="label">{noteDay(f.createdAt, today)}</span>
							<span class="quote">{snippet(f.text, 160)}</span>
							{#if f.status === 'failed'}
								<span class="retry">
									Couldn’t read this one yet ·
									<button class="btn accent" type="button" onclick={() => retry(f.id)} disabled={retrying === f.id}>
										{retrying === f.id ? 'Trying…' : 'Try again'}
									</button>
								</span>
							{/if}
						</li>
					{/each}
				</ul>
			{:else}
				<p class="note pad">Nothing yet. Mention {p.value.name} when you talk and it will show up here.</p>
			{/if}
		</section>

		<section class="section">
			<h3>Details</h3>
			<form class="stack details" onsubmit={saveDetails}>
				<label class="field">
					<span>Name</span>
					<input type="text" bind:value={name} autocomplete="off" oninput={() => (savedNote = '')} />
				</label>
				<label class="field">
					<span>WhatsApp number</span>
					<input
						type="tel"
						bind:value={phone}
						inputmode="tel"
						placeholder="With country code, e.g. 91 98…"
						oninput={() => (savedNote = '')}
					/>
				</label>
				<p class="tiny">Optional. Without it, WhatsApp asks who to send to.</p>
				<div class="spread">
					<span class="note" role="status">{savedNote}</span>
					<button class="btn line" type="submit" disabled={!changed || !name.trim()}>Save</button>
				</div>
			</form>
		</section>

		{#if linked || unlinked.length}
			<section class="section">
				<h3>On the family page</h3>
				{#if linked}
					<div class="spread pad">
						<span>Linked to <em>{linked.entry.name}</em>.</span>
						<button class="btn quiet" type="button" onclick={() => link(null)}>Unlink</button>
					</div>
				{:else}
					<p class="tiny pad">Someone replied on the family page. Is one of them {p.value.name}?</p>
					<div class="row merge">
						<label class="field grow">
							<span class="sr-only">Who on the family page is {p.value.name}</span>
							<select bind:value={memberPick}>
								<option value="">Pick a reply…</option>
								{#each unlinked as m (m.memberId)}
									<option value={m.memberId}>{m.entry.name}</option>
								{/each}
							</select>
						</label>
						<button class="btn line" type="button" disabled={!memberPick} onclick={() => link(memberPick)}>Link</button>
					</div>
				{/if}
				{#if linkNote}<p class="note" role="alert">{linkNote}</p>{/if}
			</section>
		{/if}

		<section class="section">
			<h3>Same person?</h3>
			<div class="row merge">
				<label class="field grow">
					<span class="sr-only">Merge with</span>
					<select bind:value={mergeId}>
						<option value="">Merge with…</option>
						{#each others as o (o.id)}
							<option value={o.id}>{o.name}</option>
						{/each}
					</select>
				</label>
				<button class="btn line" type="button" disabled={!mergeId} onclick={() => (mergeOpen = true)}>Merge</button>
			</div>
		</section>

		<button class="btn quiet remove" type="button" onclick={() => (removeOpen = true)}>
			Remove {p.value.name} from Kizuna
		</button>
		</div>
		</div>

		<PokeSheet bind:open={pokeOpen} person={p.value} reason={p.value.summary ?? ''} />
		<TimeSheet bind:open={timeOpen} person={p.value} />

		<Sheet bind:open={mergeOpen} title="Merge {mergeName} into" em="{p.value.name}?">
			<p class="muted">Notes, dates and names for {mergeName} will move to {p.value.name}.</p>
			<button class="btn primary big block" type="button" onclick={doMerge} disabled={busy}>Merge</button>
			<button class="btn line big block" type="button" onclick={() => (mergeOpen = false)}>Cancel</button>
		</Sheet>
		<Sheet bind:open={removeOpen} title="Remove" em="{p.value.name}?">
			<p class="muted">Your notes stay. Kizuna just stops keeping track of {p.value.name}.</p>
			<button class="btn primary big block" type="button" onclick={doRemove} disabled={busy}>Remove</button>
			<button class="btn line big block" type="button" onclick={() => (removeOpen = false)}>Keep</button>
		</Sheet>
	{:else if p.ready}
		<div class="stack">
			<p class="calm">This person isn’t <em>here</em> anymore.</p>
			<a class="btn line" href="/circle">Back to your circle</a>
		</div>
	{/if}
</div>

<style>
	.intro {
		display: flex;
		flex-direction: column;
		gap: 18px;
		padding-top: 8px;
	}
	.portrait {
		display: flex;
		flex-direction: column;
		justify-content: space-between;
		min-height: 236px;
		padding: 20px 22px 18px;
		color: #141311;
		box-shadow: var(--card-shadow);
	}
	.portrait .label {
		position: relative;
		z-index: 1;
		color: rgb(20 19 17 / 0.66);
	}
	.portrait h1 {
		position: relative;
		z-index: 1;
		font-size: 3.5rem;
		font-weight: 500;
		line-height: 1;
		letter-spacing: -0.045em;
	}
	.summary {
		font-size: var(--t-lead);
		line-height: 1.4;
		color: var(--text);
	}
	.acts {
		gap: 10px;
	}
	.ask {
		align-self: flex-start;
		margin-top: -8px;
	}
	.ask-note {
		margin-top: -14px;
	}
	.date-row {
		display: grid;
		grid-template-columns: 64px 1fr;
		align-items: center;
		gap: 12px;
		padding: 14px 0;
	}
	.date {
		display: flex;
		flex-direction: column;
		line-height: 1;
	}
	.d {
		font-size: 2.25rem;
		font-weight: 500;
		letter-spacing: -0.045em;
	}
	.m {
		font-size: var(--t-label);
		text-transform: uppercase;
		letter-spacing: 0.14em;
		color: var(--text-3);
		margin-top: 4px;
	}
	.what {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.note-row {
		display: flex;
		flex-direction: column;
		gap: 4px;
		padding: 14px 0;
	}
	.quote {
		color: var(--text);
	}
	.retry {
		display: flex;
		align-items: center;
		gap: 8px;
		flex-wrap: wrap;
		color: var(--text-2);
		font-size: var(--t-small);
	}
	.details {
		padding-top: 6px;
		gap: 14px;
	}
	.merge {
		align-items: flex-end;
		padding-top: 4px;
	}
	.pad {
		padding-top: 14px;
	}
	.thought {
		gap: 6px;
	}
	.map-row {
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding: 12px 0;
	}
	.remove {
		align-self: flex-start;
	}
	select {
		appearance: auto;
	}
	.person-grid,
	.lead,
	.rest {
		display: flex;
		flex-direction: column;
		gap: 28px;
		min-width: 0;
	}
	@media (min-width: 720px) {
		.person-grid,
		.lead,
		.rest {
			gap: 32px;
		}
	}
	/* Wide: the portrait and actions stay on the left, the story scrolls on the right. */
	@media (min-width: 1100px) {
		.page {
			max-width: 1200px;
		}
		.person-grid {
			display: grid;
			grid-template-columns: minmax(340px, 440px) minmax(0, 1fr);
			align-items: start;
			gap: 64px;
		}
		.lead {
			position: sticky;
			top: 28px;
		}
		.portrait {
			min-height: 300px;
		}
		.rest {
			padding-top: 8px;
		}
	}
</style>
