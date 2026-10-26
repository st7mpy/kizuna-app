<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import type { Settings, Window } from '@kizuna/shared';
	import {
		deleteEverything,
		exportNotes,
		getSettings,
		inviteFamilyLine,
		leaveCircle,
		loadSampleLife,
		myWindows,
		newCircleLink,
		setSharing,
		updateSettings
	} from '#lib/core/index.js';
	import { hasAnyData, readSettings, settingsLive } from '#lib/db.js';
	import type { CircleWindow } from '@kizuna/shared';
	import { whenLocal } from '#lib/ui/mapformat.js';
	import { watch } from '#lib/ui/live.svelte.js';
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

	// Kizuna map
	const live = watch<Settings | undefined>(() => settingsLive(), undefined);
	const circle = $derived(live.value?.circle);
	let shared = $state<CircleWindow[]>([]);
	let mapNote = $state('');
	let mapBusy = $state(false);
	let freshLink = $state('');
	let confirmLeave = $state(false);

	$effect(() => {
		// Preview what is shared whenever the sharing choices or free hours change.
		void [circle?.share, circle?.paused, live.value?.freeHours];
		myWindows()
			.then((w) => (shared = w))
			.catch(() => (shared = []));
	});

	async function share(patch: { share?: boolean; freeToday?: boolean; paused?: boolean }) {
		mapNote = '';
		try {
			await setSharing(patch);
		} catch {
			mapNote = 'Couldn’t change that just now. Try again in a moment.';
		}
	}
	async function inviteFamily() {
		mapBusy = true;
		mapNote = '';
		try {
			const { link } = await inviteFamilyLine();
			window.open(link, '_blank', 'noopener');
		} catch {
			mapNote = 'Couldn’t make the link just now.';
		} finally {
			mapBusy = false;
		}
	}
	async function rotate() {
		mapBusy = true;
		mapNote = '';
		try {
			freshLink = await newCircleLink();
		} catch {
			mapNote = 'Couldn’t make a new link just now.';
		} finally {
			mapBusy = false;
		}
	}
	async function copyLink() {
		try {
			await navigator.clipboard.writeText(freshLink);
			mapNote = 'Copied.';
		} catch {
			mapNote = 'Select the link and copy it.';
		}
	}
	async function leave() {
		mapBusy = true;
		try {
			await leaveCircle();
			confirmLeave = false;
			freshLink = '';
		} catch {
			mapNote = 'Couldn’t leave just now. Try again in a moment.';
			confirmLeave = false;
		} finally {
			mapBusy = false;
		}
	}
	const windowLine = (w: CircleWindow) => `${whenLocal(w.start)} to ${whenLocal(w.end).split(' ')[1]}`;

	// data
	let sampling = $state(false);
	let deleting = $state(false);
	let confirmDelete = $state(false);
	let dataNote = $state('');

	// A sample life replaces what is on the phone, so ask first when there is anything to lose.
	const hasData = watch(() => hasAnyData(), false);
	let confirmSample = $state(false);
	function askSample() {
		if (hasData.value) confirmSample = true;
		else sample();
	}

	async function sample() {
		confirmSample = false;
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
	<a href="/" class="back"><Icon name="back" size={18} /> Today</a>
	<div class="head">
		<p class="label">Settings</p>
		<h1>Settings</h1>
	</div>

	{#if s}
		<section class="block">
			<h2><span class="n num">01</span> You</h2>
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

		<section class="block">
			<h2><span class="n num">02</span> When you’re free for people</h2>
			<p class="note">Kizuna only suggests times inside these hours.</p>
			<div class="days">
				{#each WEEK_ORDER as d (d)}
					<div class="day">
						<span class="dname">{WEEKDAYS[d].slice(0, 3)}</span>
						<div class="wins">
							{#each windowsFor(d) as { w, i } (i)}
								<div class="win">
									<input
										type="time"
										class="num"
										value={w.start}
										aria-label="{WEEKDAYS[d]} from"
										onchange={(e) => setWindow(i, 'start', e.currentTarget.value)}
									/>
									<span class="to" aria-hidden="true">–</span>
									<input
										type="time"
										class="num"
										value={w.end}
										aria-label="{WEEKDAYS[d]} until"
										onchange={(e) => setWindow(i, 'end', e.currentTarget.value)}
									/>
									<button
										class="icon-btn bare"
										type="button"
										aria-label="Remove {WEEKDAYS[d]} {w.start} to {w.end}"
										onclick={() => removeWindow(i)}><Icon name="close" size={18} /></button
									>
								</div>
							{:else}
								<span class="busy">Not free</span>
							{/each}
							<button class="btn add" type="button" onclick={() => addWindow(d)}>
								<Icon name="plus" size={16} /> Add time
							</button>
						</div>
					</div>
				{/each}
			</div>
		</section>

		<section class="block">
			<h2><span class="n num">03</span> Quiet hours</h2>
			<div class="row quiet-row">
				<label class="field grow">
					<span>No nudges after</span>
					<input
						type="time"
						class="num"
						value={s.quietStart}
						onchange={(e) => e.currentTarget.value && save({ quietStart: e.currentTarget.value })}
					/>
				</label>
				<label class="field grow">
					<span>or before</span>
					<input
						type="time"
						class="num"
						value={s.quietEnd}
						onchange={(e) => e.currentTarget.value && save({ quietEnd: e.currentTarget.value })}
					/>
				</label>
			</div>
		</section>

		<section class="block">
			<h2><span class="n num">04</span> Your calendar</h2>
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

		<section class="block" id="map">
			<h2><span class="n num">05</span> Kizuna map</h2>
			<div class="notice">
				<p><strong>Shared, sealed:</strong> your first name, time zone, up to three free windows this week, and “free today” for 12 hours if you turn it on.</p>
				<p><strong>Never shared:</strong> where you are, calendar titles, notes, gift ideas or how much room you have.</p>
			</div>
			{#if circle}
				<ul class="rows toggles">
					<li>
						<label class="switch">
							<span class="grow">
								Share my weekend windows
								<span class="tiny sub">From your free hours above, minus busy times.</span>
							</span>
							<input type="checkbox" role="switch" checked={circle.share} onchange={(e) => share({ share: e.currentTarget.checked })} />
						</label>
					</li>
					<li>
						<label class="switch">
							<span class="grow">
								Show “free today” from my room tap
								<span class="tiny sub">“Lots” glows for 12 hours. Your room itself stays private.</span>
							</span>
							<input type="checkbox" role="switch" checked={circle.freeToday} onchange={(e) => share({ freeToday: e.currentTarget.checked })} />
						</label>
					</li>
					<li>
						<label class="switch">
							<span class="grow">
								Pause sharing
								<span class="tiny sub">Others just see nothing. Nobody is told.</span>
							</span>
							<input type="checkbox" role="switch" checked={circle.paused} onchange={(e) => share({ paused: e.currentTarget.checked })} />
						</label>
					</li>
				</ul>
				{#if circle.share && !circle.paused}
					<p class="note">
						{#if shared.length}
							Shared now: {#each shared as w, i (w.start)}<span class="num">{windowLine(w)}</span>{i < shared.length - 1 ? ' · ' : ''}{/each}
						{:else}
							No free windows this week to share yet.
						{/if}
					</p>
				{/if}
				<ul class="rows actions-list">
					<li>
						<button class="btn" type="button" onclick={inviteFamily} disabled={mapBusy}>
							<Icon name="send" size={20} /> Invite family on WhatsApp
						</button>
					</li>
					<li>
						<button class="btn" type="button" onclick={rotate} disabled={mapBusy}>
							<Icon name="refresh" size={20} /> New link
						</button>
					</li>
					<li>
						<button class="btn quiet" type="button" onclick={() => (confirmLeave = true)}>Leave the circle</button>
					</li>
				</ul>
				{#if freshLink}
					<div class="fresh">
						<p class="note">New link made. Old links stop working.</p>
						<input type="url" readonly value={freshLink} aria-label="New family link" onfocus={(e) => e.currentTarget.select()} />
						<button class="btn accent" type="button" onclick={copyLink}>Copy link</button>
					</div>
				{/if}
			{:else}
				<p class="note">No circle yet. Ask the family once, they tap when they’re free, no app needed.</p>
				<button class="btn line" type="button" onclick={inviteFamily} disabled={mapBusy}>
					{mapBusy ? 'Making the link…' : 'Invite family on WhatsApp'}
				</button>
			{/if}
			{#if mapNote}<p class="note" role="status">{mapNote}</p>{/if}
		</section>

		<section class="block">
			<h2><span class="n num">06</span> Languages you speak in</h2>
			<div class="row wrap langs" role="group" aria-label="Languages">
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

	<section class="block">
		<h2><span class="n num">07</span> Look</h2>
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

	<section class="block">
		<h2><span class="n num">08</span> Your notes</h2>
		<ul class="rows actions-list">
			<li>
				<button class="btn" type="button" onclick={askSample} disabled={sampling}>
					{sampling ? 'Setting up…' : 'Try with sample life'}
				</button>
			</li>
			<li>
				<button class="btn" type="button" onclick={exportAll}>
					<Icon name="download" size={20} /> Export my notes
				</button>
			</li>
			<li>
				<button class="btn quiet" type="button" onclick={() => (confirmDelete = true)}>
					Delete everything
				</button>
			</li>
		</ul>
		{#if dataNote}<p class="note" role="alert">{dataNote}</p>{/if}
	</section>

	<section class="block about">
		<h2><span class="n num">09</span> About Kizuna</h2>
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
	</section>
</div>

<Sheet bind:open={confirmSample} title="Try a sample life?">
	<p class="muted">This replaces your notes with a sample. Your own notes will be deleted.</p>
	<button class="btn primary big block" type="button" onclick={sample} disabled={sampling}>
		{sampling ? 'Setting up…' : 'Replace with sample'}
	</button>
	<button class="btn line big block" type="button" onclick={() => (confirmSample = false)}>Keep my notes</button>
</Sheet>

<Sheet bind:open={confirmLeave} title="Leave the circle?">
	<p class="muted">Your entry is deleted from the circle. Your notes and people stay on this phone.</p>
	<button class="btn primary big block" type="button" onclick={leave} disabled={mapBusy}>
		{mapBusy ? 'Leaving…' : 'Leave'}
	</button>
	<button class="btn line big block" type="button" onclick={() => (confirmLeave = false)}>Stay</button>
</Sheet>

<Sheet bind:open={confirmDelete} title="Delete everything?">
	<p class="muted">All notes, people, dates and threads on this phone will be gone. This can’t be undone.</p>
	<button class="btn primary big block" type="button" onclick={wipe} disabled={deleting}>
		{deleting ? 'Deleting…' : 'Delete everything'}
	</button>
	<button class="btn line big block" type="button" onclick={() => (confirmDelete = false)}>Keep my notes</button>
</Sheet>

<style>
	/* Numbered blocks, each topped by an ink rule. */
	.block {
		display: flex;
		flex-direction: column;
		gap: 12px;
		padding-top: 12px;
		border-top: 2px solid var(--rule);
	}
	.block h2 {
		display: flex;
		align-items: baseline;
		gap: 12px;
		font-size: 1.25rem;
		letter-spacing: -0.02em;
	}
	.block .n {
		font-size: var(--t-small);
		color: var(--text-3);
		min-width: 22px;
	}
	.days {
		display: flex;
		flex-direction: column;
	}
	.day {
		display: grid;
		grid-template-columns: 44px minmax(0, 1fr);
		align-items: start;
		gap: 8px;
		padding: 6px 0;
		border-bottom: 1px solid var(--line);
	}
	.dname {
		font-weight: 500;
		padding-top: 12px;
	}
	.wins {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
	}
	.win {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr) auto;
		align-items: center;
		gap: 6px;
		width: 100%;
	}
	.win input {
		min-width: 0;
		width: 100%;
		border-bottom: 0;
		font-size: var(--t-lead);
		text-align: left;
		padding: 8px 0;
	}
	.win input::-webkit-calendar-picker-indicator {
		display: none;
	}
	.to {
		color: var(--text-3);
		padding-right: 8px;
	}
	.busy {
		color: var(--text-3);
		padding: 12px 0 0;
	}
	.add {
		font-size: var(--t-small);
		color: var(--accent-ink);
		min-height: 44px;
	}
	.quiet-row {
		gap: 20px;
	}
	.langs {
		gap: 8px;
	}
	.lang {
		appearance: none;
		min-height: 44px;
		padding: 0 16px;
		border-radius: 999px;
		border: 0;
		box-shadow: inset 0 0 0 1px var(--line);
		background: transparent;
		color: var(--text-2);
		font: inherit;
		font-size: var(--t-small);
		font-weight: 500;
		cursor: pointer;
		transition:
			background var(--dur) var(--ease),
			color var(--dur) var(--ease);
	}
	.lang[aria-pressed='true'] {
		background: var(--rule);
		color: var(--on-rule);
		box-shadow: none;
	}
	.actions-list .btn {
		justify-content: flex-start;
		width: 100%;
		border-radius: 0;
		min-height: 52px;
	}
	.notice {
		display: flex;
		flex-direction: column;
		gap: 4px;
		font-size: var(--t-small);
		line-height: 1.5;
		color: var(--text-2);
	}
	.notice strong {
		color: var(--text);
		font-weight: 600;
	}
	.switch {
		display: flex;
		align-items: center;
		gap: 16px;
		min-height: 60px;
		padding: 10px 0;
		cursor: pointer;
	}
	.switch .sub {
		display: block;
		margin-top: 2px;
	}
	.switch input {
		appearance: none;
		flex: none;
		position: relative;
		width: 46px;
		height: 28px;
		margin: 0;
		border-radius: 999px;
		background: var(--sunk);
		box-shadow: inset 0 0 0 1px var(--line);
		cursor: pointer;
		transition: background var(--dur) var(--ease);
	}
	.switch input::after {
		content: '';
		position: absolute;
		top: 3px;
		left: 3px;
		width: 22px;
		height: 22px;
		border-radius: 50%;
		background: var(--surface);
		box-shadow: 0 0 0 1px var(--line);
		transition: transform var(--dur) var(--ease);
	}
	.switch input:checked {
		background: var(--accent);
		box-shadow: none;
	}
	.switch input:checked::after {
		transform: translateX(18px);
		box-shadow: none;
		background: var(--on-accent);
	}
	.switch input:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 3px;
	}
	.fresh {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 4px;
	}
	.fresh input {
		font-size: var(--t-small);
	}
	.about p {
		font-size: var(--t-small);
		line-height: 1.6;
		color: var(--text-2);
	}
	.about strong {
		color: var(--text);
		font-weight: 600;
	}
</style>
