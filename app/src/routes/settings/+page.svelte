<script lang="ts">
	import { clearEntered } from '#lib/landing/entered.js';
	import { screen } from '#lib/ui/screen.svelte.js';
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import type { Settings, Window } from '@kizuna/shared';
	import {
		deleteEverything,
		exportNotes,
		getSettings,
		checkCalendar,
		inviteFamilyLine,
		isCalendarLink,
		markInvited,
		leaveCircle,
		loadSample,
		SAMPLES,
		type SampleKey,
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
	import TimeSelect from '#lib/ui/TimeSelect.svelte';
	import { newWindow, windowProblem } from '#lib/ui/freehours.js';
	import { shareAfter } from '#lib/ui/toast.svelte.js';

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
		return (s?.freeHours ?? [])
			.map((w, i) => ({ w, i }))
			.filter((x) => x.w.day === day)
			.sort((a, b) => a.w.start.localeCompare(b.w.start));
	}
	// A wrong window is not saved; the note says why, next to that day.
	let winNote = $state<{ day: number; text: string } | null>(null);
	function setWindow(i: number, key: 'start' | 'end', v: string, el?: HTMLSelectElement) {
		if (!s || !v) return;
		const w = { ...s.freeHours[i], [key]: v };
		const others = s.freeHours.filter((x, j) => j !== i && x.day === w.day);
		const problem = windowProblem(w, others);
		if (problem) {
			winNote = { day: w.day, text: problem };
			if (el) el.value = s.freeHours[i][key];
			return;
		}
		winNote = null;
		s.freeHours[i] = w;
		save({ freeHours: $state.snapshot(s.freeHours) }, 300);
	}
	const roomFor = (day: number) => newWindow(day, windowsFor(day).map((x) => x.w));
	function addWindow(day: number) {
		if (!s) return;
		const w = roomFor(day);
		if (!w) return;
		winNote = null;
		s.freeHours = [...s.freeHours, { day, ...w }];
		save({ freeHours: $state.snapshot(s.freeHours) });
	}
	function removeWindow(i: number) {
		if (!s) return;
		winNote = null;
		s.freeHours = s.freeHours.filter((_, j) => j !== i);
		save({ freeHours: $state.snapshot(s.freeHours) });
	}

	// The calendar link: saved only when it is a link, then read once so the user knows it works.
	type CalStatus = 'checking' | 'ok' | 'failed' | 'offline' | 'bad';
	const CAL_WORDS: Record<CalStatus, string> = {
		checking: 'Checking your calendar…',
		ok: 'Connected. Kizuna will avoid your busy times.',
		failed: 'Couldn’t read this calendar. Check it’s the secret iCal address, not the public one.',
		offline: 'Saved. Kizuna will read it when you’re online.',
		bad: 'That doesn’t look like a calendar link. It should start with https://'
	};
	let calStatus = $state<CalStatus | null>(null);
	let calTimer: ReturnType<typeof setTimeout> | undefined;
	let calSeq = 0;
	function calendarInput(raw: string) {
		const url = raw.trim();
		clearTimeout(calTimer);
		const my = ++calSeq;
		if (!url) {
			calStatus = null;
			save({ icalUrl: undefined }, 600);
			return;
		}
		calTimer = setTimeout(async () => {
			if (!isCalendarLink(url)) {
				calStatus = 'bad';
				return;
			}
			save({ icalUrl: url });
			calStatus = 'checking';
			const r = await checkCalendar(url);
			if (my === calSeq) calStatus = r;
		}, 700);
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
			// The tab opens before the link is made, so Safari doesn't block it as a popup.
			let invitees: string[] = [];
			const r = await shareAfter(async () => {
				const x = await inviteFamilyLine();
				invitees = x.invitees;
				return x.line;
			});
			if (r === 'blocked') mapNote = 'Your link is ready. Tap again to send it.';
			else if (r !== 'cancelled') await markInvited(invitees);
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
	let sampleKey = $state<SampleKey>('abroad');
	function askSample(key: SampleKey) {
		sampleKey = key;
		if (hasData.value) confirmSample = true;
		else sample();
	}

	async function sample() {
		confirmSample = false;
		sampling = true;
		dataNote = '';
		try {
			await loadSample(sampleKey);
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
			clearEntered();
			confirmDelete = false;
			goto('/');
		} catch {
			dataNote = 'Couldn’t delete just now. Nothing was removed.';
			confirmDelete = false;
		} finally {
			deleting = false;
		}
	}

	const INDEX: [string, string][] = [
		['you', 'You'],
		['free', 'When you’re free'],
		['quiet', 'Quiet hours'],
		['calendar', 'Your calendar'],
		['map', 'Kizuna map'],
		['look', 'Look'],
		['notes', 'Your notes'],
		['about', 'About Kizuna']
	];
</script>

<svelte:head><title>Settings · Kizuna</title></svelte:head>

<div class="page">
	{#if !screen.rail}<a href="/" class="back"><Icon name="back" size={18} /> Today</a>{/if}
	<div class="head">
		<p class="label">Settings</p>
		<h1>Settings</h1>
	</div>

	<div class="settings-grid">
	{#if screen.wide}
		<nav class="index" aria-label="Settings sections">
			<ol>
				{#each INDEX as [id, label], i (id)}
					<li><a href="#{id}">{label}</a></li>
				{/each}
			</ol>
		</nav>
	{/if}
	<div class="content">
	{#if s}
		<section class="set-block" id="you">
			<h2>You</h2>
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

		<section class="set-block" id="free">
			<h2>When you’re free for people</h2>
			<p class="note">Kizuna only suggests times inside these hours.</p>
			<div class="days">
				{#each WEEK_ORDER as d (d)}
					<div class="day">
						<span class="dname">{WEEKDAYS[d].slice(0, 3)}</span>
						<div class="wins">
							{#each windowsFor(d) as { w, i } (i)}
								<div class="win">
									<TimeSelect
										value={w.start}
										label="{WEEKDAYS[d]} from"
										onchange={(v, el) => setWindow(i, 'start', v, el)}
									/>
									<span class="to" aria-hidden="true">–</span>
									<TimeSelect
										value={w.end}
										label="{WEEKDAYS[d]} until"
										onchange={(v, el) => setWindow(i, 'end', v, el)}
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
							{#if winNote?.day === d}<p class="note warn" role="alert">{winNote.text}</p>{/if}
							<button class="btn add" type="button" onclick={() => addWindow(d)} disabled={!roomFor(d)}>
								<Icon name="plus" size={16} /> Add time
							</button>
						</div>
					</div>
				{/each}
			</div>
		</section>

		<section class="set-block" id="quiet">
			<h2>Quiet hours</h2>
			<div class="row quiet-row">
				<label class="field grow">
					<span>No nudges after</span>
					<TimeSelect value={s.quietStart} onchange={(v) => v && save({ quietStart: v })} />
				</label>
				<label class="field grow">
					<span>or before</span>
					<TimeSelect value={s.quietEnd} onchange={(v) => v && save({ quietEnd: v })} />
				</label>
			</div>
		</section>

		<section class="set-block" id="calendar">
			<h2>Your calendar</h2>
			<label class="field">
				<span>Private calendar link (iCal)</span>
				<input
					type="url"
					value={s.icalUrl ?? ''}
					placeholder="https://calendar.google.com/…/basic.ics"
					oninput={(e) => calendarInput(e.currentTarget.value)}
					aria-describedby="cal-status"
				/>
			</label>
			{#if calStatus}
				<p id="cal-status" class="note cal-status" class:ok={calStatus === 'ok'} class:warn={calStatus !== 'ok' && calStatus !== 'checking'} role="status">
					{CAL_WORDS[calStatus]}
				</p>
			{/if}
			<p class="note">
				Optional. In Google Calendar on a computer: Settings, pick your calendar, then “Secret address in
				iCal format”. Kizuna only reads when you’re busy.
			</p>
		</section>

		<section class="set-block" id="map">
			<h2>Kizuna map</h2>
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

		{#if note}<p class="note" role="alert">{note}</p>{/if}
	{/if}

	<section class="set-block" id="look">
		<h2>Look</h2>
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

	<section class="set-block" id="notes">
		<h2>Your notes</h2>
		<ul class="rows actions-list">
			{#each SAMPLES as x (x.key)}
				<li>
					<button class="btn" type="button" onclick={() => askSample(x.key)} disabled={sampling} data-sample={x.key}>
						{sampling && sampleKey === x.key ? 'Setting up…' : `Sample: ${x.label}`}
					</button>
				</li>
			{/each}
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

	<section class="set-block about" id="about">
		<h2>About Kizuna</h2>
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
		<a href="/about" class="btn line about-link">About Kizuna <Icon name="arrow" size={18} /></a>
	</section>
	</div>
	</div>
</div>

<Sheet bind:open={confirmSample} title="Load a sample family?">
	<p class="muted">{SAMPLES.find((x) => x.key === sampleKey)?.blurb} This replaces what is on this phone, so your own notes will be deleted.</p>
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
	.settings-grid,
	.content {
		display: flex;
		flex-direction: column;
		gap: 28px;
		min-width: 0;
	}
	.set-block {
		scroll-margin-top: 24px;
	}
	.about-link {
		align-self: flex-start;
		margin-top: 4px;
	}
	@media (min-width: 720px) {
		.content {
			gap: 40px;
		}
		.days .day {
			grid-template-columns: 64px minmax(0, 1fr);
		}
		.wins .win {
			grid-template-columns: 7.5em auto 7.5em auto;
			width: auto;
		}
	}
	/* Wide: a section index on the left, settings on the right. */
	@media (min-width: 1100px) {
		.page {
			max-width: 1080px;
		}
		.settings-grid {
			display: grid;
			grid-template-columns: 220px minmax(0, 680px);
			gap: 64px;
			align-items: start;
		}
		.index {
			position: sticky;
			top: 28px;
		}
		.index ol {
			list-style: none;
			margin: 0;
			padding: 0;
			display: flex;
			flex-direction: column;
			gap: 2px;
		}
		.index a {
			display: flex;
			gap: 12px;
			align-items: baseline;
			min-height: 40px;
			padding: 9px 14px;
			border-radius: 12px;
			color: var(--text-2);
			text-decoration: none;
			font-size: var(--t-small);
			font-weight: 500;
		}
		.index a:hover {
			color: var(--text);
			background: var(--bg-2);
		}
	}
	/* Each section is a soft rounded surface. Not called "block": that is the global full-width button class. */
	.set-block {
		display: flex;
		flex-direction: column;
		gap: 12px;
		padding: 22px 22px 18px;
		border-radius: var(--r-card);
		background: var(--surface);
		-webkit-backdrop-filter: var(--blur);
		backdrop-filter: var(--blur);
		box-shadow: var(--card-shadow);
	}
	@media (max-width: 719px) {
		.set-block {
			padding: 18px 14px 14px;
		}
	}
	.set-block h2 {
		display: flex;
		align-items: baseline;
		gap: 12px;
		font-size: 1.25rem;
		letter-spacing: -0.02em;
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
	/* Narrow phones: the day name sits above its times, so the times get the whole width. */
	@media (max-width: 479px) {
		.day {
			grid-template-columns: minmax(0, 1fr);
			gap: 4px;
			padding: 10px 0;
		}
		.dname {
			padding-top: 0;
		}
	}
	.wins {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 6px;
		min-width: 0;
	}
	.win {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr) auto;
		align-items: center;
		gap: 6px;
		width: 100%;
	}
	.win :global(select) {
		font-size: var(--t-small);
		padding-top: 8px;
		padding-bottom: 8px;
		padding-left: 12px;
	}
	.warn {
		color: var(--text);
	}
	.cal-status.ok {
		color: var(--accent-ink);
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
	.quiet-row .field {
		flex: 1 1 0;
		min-width: 0;
	}
	.actions-list .btn {
		justify-content: flex-start;
		text-align: left;
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
		background: var(--surface-solid);
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
