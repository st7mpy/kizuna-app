<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import type { Settings, Window } from '@kizuna/shared';
	import {
		deleteEverything,
		exportNotes,
		getSettings,
		loadSampleLife,
		updateSettings
	} from '#lib/core/index.js';
	import { readSettings } from '#lib/db.js';
	import { dayKey, minutes, WEEK_ORDER, WEEKDAYS } from '#lib/ui/format.js';
	import { getTheme, setTheme, type ThemeChoice } from '#lib/ui/theme.js';
	import Segmented from '#lib/ui/Segmented.svelte';
	import Sheet from '#lib/ui/Sheet.svelte';
	import Icon from '#lib/ui/Icon.svelte';

	let s = $state<Settings | null>(null);
	let note = $state('');
	let theme = $state<ThemeChoice>("system");

	onMount(async () => {
		theme = getTheme();
		try {
			s = await getSettings();
		} catch {
			s = await readSettings();
		}
	});

	let timer: ReturnType<typeof setTimeout> | undefined;
	let pending: Partial<Settings> = {};
	function save(patch: Partial<Settings>, wait = 0) {
		pending = { ...pending, ...patch };
		clearTimeout(timer);
		timer = setTimeout(async () => {
			const p = pending;
			pending = {};
			try {
				await updateSettings(p);
				note = '';
			} catch {
				note = 'Couldn’t save that just now. Try again in a moment.';
			}
		}, wait);
	}

	// free hours
	function windowsFor(day: number): { w: Window; i: number }[] {
		return (s?.freeHours ?? []).map((w, i) => ({ w, i })).filter((x) => x.w.day === day);
	}
	function setWindow(i: number, key: 'start' | 'end', v: string) {
		if (!s || !v) return;
		s.freeHours[i] = { ...s.freeHours[i], [key]: v };
		save({ freeHours: $state.snapshot(s.freeHours) }, 300);
	}
	function addWindow(day: number) {
		if (!s) return;
		const last = windowsFor(day).at(-1)?.w;
		const start = last && minutes(last.end) <= 20 * 60 ? last.end : day === 0 || day === 6 ? '10:00' : '18:30';
		const end = `${String(Math.min(23, Number(start.slice(0, 2)) + 2)).padStart(2, '0')}:${start.slice(3)}`;
		s.freeHours = [...s.freeHours, { day, start, end }];
		save({ freeHours: $state.snapshot(s.freeHours) });
	}
	function removeWindow(i: number) {
		if (!s) return;
		s.freeHours = s.freeHours.filter((_, j) => j !== i);
		save({ freeHours: $state.snapshot(s.freeHours) });
	}

	const LANGS = [
		{ code: 'en', label: 'English' },
		{ code: 'hi', label: 'Hindi' },
		{ code: 'bn', label: 'Bengali' },
		{ code: 'mr', label: 'Marathi' },
		{ code: 'ta', label: 'Tamil' },
		{ code: 'te', label: 'Telugu' },
		{ code: 'gu', label: 'Gujarati' },
		{ code: 'pa', label: 'Punjabi' },
		{ code: 'ur', label: 'Urdu' }
	];
	function toggleLang(code: string) {
		if (!s) return;
		const has = s.languageBias.includes(code);
		s.languageBias = has ? s.languageBias.filter((c) => c !== code) : [...s.languageBias, code];
		save({ languageBias: $state.snapshot(s.languageBias) });
	}

	function pickTheme(t: ThemeChoice) {
		theme = t;
		setTheme(t);
	}

	// data
	let sampling = $state(false);
	let deleting = $state(false);
	let confirmDelete = $state(false);
	let dataNote = $state('');

	async function sample() {
		sampling = true;
		dataNote = '';
		try {
			await loadSampleLife();
			goto('/');
		} catch {
			dataNote = 'Couldn’t load the sample just now.';
		} finally {
			sampling = false;
		}
	}

	async function exportAll() {
		dataNote = '';
		try {
			const blob = await exportNotes();
			const ext = blob.type.includes('json') ? 'json' : blob.type.includes('markdown') ? 'md' : 'txt';
			const url = URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = url;
			a.download = `kizuna-notes-${dayKey()}.${ext}`;
			a.click();
			setTimeout(() => URL.revokeObjectURL(url), 2000);
		} catch {
			dataNote = 'Couldn’t export just now.';
		}
	}

	async function wipe() {
		deleting = true;
		try {
			await deleteEverything();
			confirmDelete = false;
			goto('/');
		} catch {
			dataNote = 'Couldn’t delete just now. Nothing was removed.';
			confirmDelete = false;
		} finally {
			deleting = false;
		}
	}
</script>

<svelte:head><title>Settings · Kizuna</title></svelte:head>

<div class="page">
	<a href="/" class="back"><Icon name="back" size={20} /> Today</a>
	<h1>Settings</h1>

	{#if s}
		<section class="stack">
			<label class="field">
				<span>Your first name</span>
				<input
					type="text"
					value={s.myName}
					autocomplete="given-name"
					placeholder="Shown on pick-a-time pages"
					oninput={(e) => save({ myName: e.currentTarget.value.trim() }, 500)}
				/>
			</label>
		</section>

		<section class="stack">
			<h3>When you’re free for people</h3>
			<p class="note">Kizuna only suggests times inside these hours.</p>
			<div class="card days">
				{#each WEEK_ORDER as d (d)}
					<div class="day">
						<span class="dname">{WEEKDAYS[d].slice(0, 3)}</span>
						<div class="wins">
							{#each windowsFor(d) as { w, i } (i)}
								<div class="win">
									<input
										type="time"
										value={w.start}
										aria-label="{WEEKDAYS[d]} from"
										onchange={(e) => setWindow(i, 'start', e.currentTarget.value)}
									/>
									<span class="to" aria-hidden="true">–</span>
									<input
										type="time"
										value={w.end}
										aria-label="{WEEKDAYS[d]} until"
										onchange={(e) => setWindow(i, 'end', e.currentTarget.value)}
									/>
									<button
										class="icon-btn"
										type="button"
										aria-label="Remove {WEEKDAYS[d]} {w.start} to {w.end}"
										onclick={() => removeWindow(i)}><Icon name="close" size={18} /></button
									>
								</div>
							{:else}
								<span class="busy">Not free</span>
							{/each}
							<button class="btn quiet add" type="button" onclick={() => addWindow(d)}>+ Add time</button>
						</div>
					</div>
				{/each}
			</div>
		</section>

		<section class="stack">
			<h3>Quiet hours</h3>
			<div class="row">
				<label class="field grow">
					<span>No nudges after</span>
					<input
						type="time"
						value={s.quietStart}
						onchange={(e) => e.currentTarget.value && save({ quietStart: e.currentTarget.value })}
					/>
				</label>
				<label class="field grow">
					<span>or before</span>
					<input
						type="time"
						value={s.quietEnd}
						onchange={(e) => e.currentTarget.value && save({ quietEnd: e.currentTarget.value })}
					/>
				</label>
			</div>
		</section>

		<section class="stack">
			<h3>Your calendar</h3>
			<label class="field">
				<span>Private calendar link (iCal)</span>
				<input
					type="url"
					value={s.icalUrl ?? ''}
					placeholder="https://calendar.google.com/…/basic.ics"
					oninput={(e) => save({ icalUrl: e.currentTarget.value.trim() || undefined }, 600)}
				/>
			</label>
			<p class="note">
				Optional. In Google Calendar on a computer: Settings, pick your calendar, then “Secret address in
				iCal format”. Kizuna only reads when you’re busy.
			</p>
		</section>

		<section class="stack">
			<h3>Languages you speak in</h3>
			<div class="row wrap" role="group" aria-label="Languages">
				{#each LANGS as l (l.code)}
					<button
						type="button"
						class="lang"
						aria-pressed={s.languageBias.includes(l.code)}
						onclick={() => toggleLang(l.code)}>{l.label}</button
					>
				{/each}
			</div>
		</section>

		{#if note}<p class="note" role="alert">{note}</p>{/if}
	{/if}

	<section class="stack">
		<h3>Look</h3>
		<Segmented
			label="Theme"
			value={theme}
			options={[
				{ value: 'system', label: 'Auto' },
				{ value: 'light', label: 'Light' },
				{ value: 'dark', label: 'Dark' }
			]}
			onchange={pickTheme}
		/>
	</section>

	<section class="stack">
		<h3>Your notes</h3>
		<div class="stack tight">
			<button class="btn block" type="button" onclick={sample} disabled={sampling}>
				{sampling ? 'Setting up…' : 'Try with sample life'}
			</button>
			<button class="btn block" type="button" onclick={exportAll}>
				<Icon name="download" size={20} /> Export my notes
			</button>
			<button class="btn quiet block" type="button" onclick={() => (confirmDelete = true)}>
				Delete everything
			</button>
		</div>
		{#if dataNote}<p class="note" role="alert">{dataNote}</p>{/if}
	</section>

	<section class="stack about">
		<h3>About Kizuna</h3>
		<div class="card">
			<p>
				<strong>Your notes stay on this phone.</strong> When Kizuna reads a note or hears you, the words pass
				through to the model and back; Kizuna’s server keeps none of it. A pick-a-time link holds just your
				first name and the times you offer, for seven days.
			</p>
			<p>
				Kizuna uses Meta’s <strong>Muse Spark</strong> to understand notes, find times and draft lines, and
				<strong>Muse Voice Transcribe</strong> to hear you. Never the contributor models that learn from what
				people send.
			</p>
			<p>You send every message yourself. No streaks, no scores, no counting.</p>
			<p class="muted">Kizuna is not a health app. It doesn’t diagnose, track moods or give advice.</p>
		</div>
	</section>
</div>

<Sheet bind:open={confirmDelete} title="Delete everything?">
	<p class="muted">All notes, people, dates and threads on this phone will be gone. This can’t be undone.</p>
	<button class="btn primary big block" type="button" onclick={wipe} disabled={deleting}>
		{deleting ? 'Deleting…' : 'Delete everything'}
	</button>
	<button class="btn big block" type="button" onclick={() => (confirmDelete = false)}>Keep my notes</button>
</Sheet>

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
	.grow {
		flex: 1;
	}
	.days {
		padding: 6px 10px 6px 14px;
		gap: 0;
	}
	.day {
		display: grid;
		grid-template-columns: 40px minmax(0, 1fr);
		align-items: start;
		gap: 8px;
		padding: 10px 0;
	}
	.day + .day {
		border-top: 1px solid var(--line);
	}
	.dname {
		font-weight: 620;
		padding-top: 12px;
	}
	.wins {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 6px;
	}
	.win {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr) auto;
		align-items: center;
		gap: 4px;
		width: 100%;
	}
	.win input {
		min-width: 0;
		width: 100%;
		padding: 8px 4px;
		font-size: 0.9375rem;
		text-align: center;
	}
	.win input::-webkit-calendar-picker-indicator {
		display: none;
	}
	.win .icon-btn {
		width: 40px;
		margin-right: -6px;
	}
	.to {
		color: var(--text-3);
	}
	.busy {
		color: var(--text-3);
		padding-top: 12px;
	}
	.add {
		padding: 0 4px;
		font-size: 0.9375rem;
		color: var(--accent-ink);
	}
	.lang {
		appearance: none;
		min-height: var(--tap);
		padding: 0 16px;
		border-radius: 999px;
		border: 1px solid var(--line);
		background: var(--surface);
		color: var(--text-2);
		font: inherit;
		font-size: 0.9375rem;
		font-weight: 560;
		cursor: pointer;
	}
	.lang[aria-pressed='true'] {
		border-color: var(--accent);
		color: var(--accent-ink);
		background: var(--accent-soft);
	}
	.tight {
		gap: 8px;
	}
	.about .card {
		gap: 12px;
	}
	.about p {
		font-size: 0.9375rem;
		line-height: 1.55;
	}
</style>
