<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import type { Fragment, KEvent, Person } from '@kizuna/shared';
	import { mergePeople, removePerson, updatePerson } from '#lib/core/index.js';
	import { allPeople, eventsFor, fragmentsMentioning, person } from '#lib/db.js';
	import { watch } from '#lib/ui/live.svelte.js';
	import { dayKey, dayLabel, noteDay, snippet } from '#lib/ui/format.js';
	import PokeSheet from '#lib/ui/PokeSheet.svelte';
	import TimeSheet from '#lib/ui/TimeSheet.svelte';
	import Sheet from '#lib/ui/Sheet.svelte';
	import Icon from '#lib/ui/Icon.svelte';

	const id = $derived(page.params.id ?? '');
	const p = watch<Person | undefined>(() => person(id), undefined);
	const events = watch<KEvent[]>(() => eventsFor(id), []);
	const notes = watch<Fragment[]>(() => fragmentsMentioning(id), []);
	const everyone = watch<Person[]>(() => allPeople(), []);

	const today = dayKey();
	const upcoming = $derived(
		events.value
			.filter((e) => e.day && e.day >= today)
			.sort((a, b) => (a.day ?? '').localeCompare(b.day ?? ''))
			.slice(0, 4)
	);
	const recent = $derived(notes.value.slice(0, 5));
	const others = $derived(everyone.value.filter((o) => o.id !== id && o.circle !== 'out'));

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
	<a href="/circle" class="back"><Icon name="back" size={20} /> Circle</a>

	{#if p.value}
		<div class="stack head">
			<h1>{p.value.name}</h1>
			{#if p.value.summary}<p class="summary">{p.value.summary}</p>{/if}
			<div class="row">
				<button class="btn primary grow" type="button" onclick={() => (pokeOpen = true)}>Poke</button>
				<button class="btn grow" type="button" onclick={() => (timeOpen = true)}>Find a time</button>
			</div>
		</div>

		{#if upcoming.length}
			<section class="stack">
				<h3>Coming up</h3>
				<ul class="list">
					{#each upcoming as e (e.id)}
						<li>
							<span class="when">{dayLabel(e.day ?? today, today)}{e.time ? `, ${e.time}` : ''}</span>
							<span>{e.what}</span>
						</li>
					{/each}
				</ul>
			</section>
		{/if}

		<section class="stack">
			<h3>From your notes</h3>
			{#if recent.length}
				<ul class="list">
					{#each recent as f (f.id)}
						<li>
							<span class="when">{noteDay(f.createdAt, today)}</span>
							<span class="quote">{snippet(f.text, 160)}</span>
						</li>
					{/each}
				</ul>
			{:else}
				<p class="note">Nothing yet. Mention {p.value.name} when you talk and it will show up here.</p>
			{/if}
		</section>

		<section class="stack">
			<h3>Details</h3>
			<form class="card stack" onsubmit={saveDetails}>
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
					<button class="btn" type="submit" disabled={!changed || !name.trim()}>Save</button>
				</div>
			</form>
		</section>

		<section class="stack">
			<h3>Same person?</h3>
			<div class="row">
				<label class="field grow">
					<span class="sr-only">Merge with</span>
					<select bind:value={mergeId}>
						<option value="">Merge with…</option>
						{#each others as o (o.id)}
							<option value={o.id}>{o.name}</option>
						{/each}
					</select>
				</label>
				<button class="btn" type="button" disabled={!mergeId} onclick={() => (mergeOpen = true)}>Merge</button>
			</div>
		</section>

		<button class="btn quiet remove" type="button" onclick={() => (removeOpen = true)}>
			Remove {p.value.name} from Kizuna
		</button>

		<PokeSheet bind:open={pokeOpen} person={p.value} reason={p.value.summary ?? ''} />
		<TimeSheet bind:open={timeOpen} person={p.value} />

		<Sheet bind:open={mergeOpen} title="Merge {mergeName} into {p.value.name}?">
			<p class="muted">Notes, dates and names for {mergeName} will move to {p.value.name}.</p>
			<button class="btn primary big block" type="button" onclick={doMerge} disabled={busy}>Merge</button>
			<button class="btn big block" type="button" onclick={() => (mergeOpen = false)}>Cancel</button>
		</Sheet>
		<Sheet bind:open={removeOpen} title="Remove {p.value.name}?">
			<p class="muted">Your notes stay. Kizuna just stops keeping track of {p.value.name}.</p>
			<button class="btn primary big block" type="button" onclick={doRemove} disabled={busy}>Remove</button>
			<button class="btn big block" type="button" onclick={() => (removeOpen = false)}>Keep</button>
		</Sheet>
	{:else if p.ready}
		<div class="stack">
			<p class="calm">This person isn’t here anymore.</p>
			<a class="btn" href="/circle">Back to your circle</a>
		</div>
	{/if}
</div>

<style>
	.back {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		min-height: var(--tap);
		margin: -8px 0 -12px -6px;
		color: var(--text-2);
		text-decoration: none;
		font-weight: 560;
		align-self: flex-start;
	}
	.head {
		gap: 10px;
	}
	.summary {
		font-size: 1.125rem;
		color: var(--text-2);
	}
	.head .row {
		margin-top: 8px;
	}
	.grow {
		flex: 1;
	}
	.list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		background: var(--surface);
		border: 1px solid var(--line);
		border-radius: var(--radius);
	}
	.list li {
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding: 14px 16px;
	}
	.list li + li {
		border-top: 1px solid var(--line);
	}
	.when {
		font-size: 0.8125rem;
		font-weight: 600;
		color: var(--text-3);
	}
	.quote {
		color: var(--text);
	}
	.remove {
		align-self: flex-start;
		margin-left: -12px;
	}
	.calm {
		font-size: 1.25rem;
		font-weight: 620;
	}
	select {
		appearance: auto;
	}
</style>
