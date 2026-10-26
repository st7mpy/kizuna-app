<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import type { Fragment, KEvent, Person } from '@kizuna/shared';
	import { mergePeople, removePerson, retryFragment, updatePerson } from '#lib/core/index.js';
	import { allPeople, eventsFor, fragmentsMentioning, person } from '#lib/db.js';
	import { watch } from '#lib/ui/live.svelte.js';
	import { dayKey, dayLabel, noteDay, snippet } from '#lib/ui/format.js';
	import PokeSheet from '#lib/ui/PokeSheet.svelte';
	import TimeSheet from '#lib/ui/TimeSheet.svelte';
	import Sheet from '#lib/ui/Sheet.svelte';
	import Icon from '#lib/ui/Icon.svelte';
	import { hueFor } from '#lib/ui/hue.js';

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
		</section>

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
		color: #121214;
	}
	.portrait .label {
		position: relative;
		z-index: 1;
		color: rgb(18 18 20 / 0.72);
	}
	.portrait h1 {
		position: relative;
		z-index: 1;
		font-size: 4.25rem;
		line-height: 0.95;
		letter-spacing: -0.02em;
	}
	.portrait h1 em {
		font-size: 1em;
	}
	.summary {
		font-size: var(--t-lead);
		line-height: 1.4;
		color: var(--text);
	}
	.acts {
		gap: 10px;
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
		font-size: 2.5rem;
		font-weight: 400;
		letter-spacing: -0.04em;
	}
	.m {
		font-size: var(--t-label);
		text-transform: uppercase;
		letter-spacing: 0.08em;
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
	.remove {
		align-self: flex-start;
	}
	select {
		appearance: auto;
	}
</style>
