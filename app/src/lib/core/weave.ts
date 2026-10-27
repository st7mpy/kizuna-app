// The long-context pass: who matters right now, which names are the same person, open threads.
import type { Settings, Thread, WeaveOutput } from '@kizuna/shared';
import { db, newId, readSettings } from '../db.ts';
import { addDays, dayToDate, localDay } from './days.ts';
import { matchPerson, mergePeople, normName, unionAliases, upsertPerson } from './people.ts';
import { RelayError, isOnline, spark } from './relay.ts';
import { updateSettings } from './settings.ts';

export const WEAVE_NOTE_DAYS = 60;
export const WEAVE_NOTE_CAP = 200;

/** After model failures in a row, wait this long (it is the most costly call). */
export const WEAVE_FAIL_WAIT_MS = 6 * 3600_000;
/** The first model failure gets one quick retry, in case it was a one-off. */
export const WEAVE_FIRST_FAIL_WAIT_MS = 5 * 60_000;
/** Busy, slow or unreachable relay (a shared venue IP hits the limit fast): short waits. */
export const WEAVE_BUSY_WAITS_MS = [60_000, 120_000, 300_000];

type WeaveSettings = Pick<Settings, 'lastWeaveAt' | 'notesSinceWeave' | 'weaveFailedAt' | 'weaveRetryAt'>;

/** Not the note's or the model's fault: try again soon. */
function isBusy(e: unknown): boolean {
	return !(e instanceof RelayError) || e.isTransient || e.code === 'http';
}

/** How long to wait after this failure, given the counts so far (before this failure). */
export function weaveBackoffMs(e: unknown, s: Pick<Settings, 'weaveFails' | 'weaveBusy'>): { wait: number; busy: boolean } {
	if (isBusy(e)) {
		const n = s.weaveBusy ?? 0;
		return { wait: WEAVE_BUSY_WAITS_MS[Math.min(n, WEAVE_BUSY_WAITS_MS.length - 1)], busy: true };
	}
	return { wait: (s.weaveFails ?? 0) >= 1 ? WEAVE_FAIL_WAIT_MS : WEAVE_FIRST_FAIL_WAIT_MS, busy: false };
}

/** Due when 10+ notes arrived, or a day has passed and 3+ arrived; never while a backoff is running. */
export function weaveDue(s: WeaveSettings, now = new Date()): boolean {
	if (s.weaveRetryAt && now.getTime() < Date.parse(s.weaveRetryAt)) return false;
	// Older installs only stored the failure time: give those a short wait, not 6 h.
	if (!s.weaveRetryAt && s.weaveFailedAt && now.getTime() - Date.parse(s.weaveFailedAt) < WEAVE_FIRST_FAIL_WAIT_MS) return false;
	const n = s.notesSinceWeave ?? 0;
	if (n >= 10) return true;
	const dayPassed = !s.lastWeaveAt || now.getTime() - new Date(s.lastWeaveAt).getTime() > 24 * 3600_000;
	return dayPassed && n >= 3;
}

// "Building your circle…": true while a weave runs or a quick retry is waiting.
let building = false;
const listeners = new Set<(b: boolean) => void>();
function setBuilding(b: boolean) {
	if (building === b) return;
	building = b;
	for (const fn of listeners) fn(b);
}
/** Subscribes to whether the circle is being built right now; returns an unsubscribe. */
export function onWeaveBuilding(fn: (building: boolean) => void): () => void {
	listeners.add(fn);
	fn(building);
	return () => listeners.delete(fn);
}

let retryTimer: ReturnType<typeof setTimeout> | undefined;
function scheduleRetry(ms: number) {
	clearTimeout(retryTimer);
	retryTimer = setTimeout(() => void runWeave().catch(() => {}), ms + 500);
}

let weaving: Promise<void> | null = null;

/** Long-context pass. Runs when due (daily or 10+ new notes) unless force. */
export function runWeave(force = false): Promise<void> {
	weaving ??= (async () => {
		let retrying = false;
		try {
			const s = await readSettings();
			if ((!force && !weaveDue(s)) || !isOnline()) return;
			const since = dayToDate(addDays(localDay(), -WEAVE_NOTE_DAYS)).toISOString();
			const notes = (await db.fragments.where('createdAt').aboveOrEqual(since).toArray())
				.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
				.slice(0, WEAVE_NOTE_CAP)
				.reverse();
			if (!notes.length) return;
			const people = await db.people.toArray();
			setBuilding(true);
			let out: WeaveOutput;
			try {
				out = await spark('weave', {
					today: localDay(),
					notes: notes.map((f) => ({ id: f.id, day: localDay(f.createdAt), text: f.text })),
					people: people.map((p) => ({ id: p.id, name: p.name, aliases: p.aliases, relation: p.relation, circle: p.circle }))
				});
			} catch (e) {
				// Offline is not a failure: the online event tries again.
				if (e instanceof RelayError && e.isConnectivity && !isOnline()) throw e;
				const cur = await readSettings();
				const { wait, busy } = weaveBackoffMs(e, cur);
				const now = Date.now();
				await updateSettings({
					weaveRetryAt: new Date(now + wait).toISOString(),
					...(busy
						? { weaveBusy: (cur.weaveBusy ?? 0) + 1 }
						: { weaveFails: (cur.weaveFails ?? 0) + 1, weaveFailedAt: new Date(now).toISOString() })
				});
				// Short waits retry by themselves while the app is open.
				if (wait <= WEAVE_FIRST_FAIL_WAIT_MS) {
					retrying = true;
					scheduleRetry(wait);
				}
				throw e;
			}
			await applyWeave(out);
		} finally {
			weaving = null;
			setBuilding(retrying);
		}
	})();
	return weaving;
}

/**
 * Applies a weave result. `noteId` maps the note ids in the output to fragment ids
 * (identity for live runs; the sample life uses note indexes).
 */
export async function applyWeave(out: WeaveOutput, noteId: (id: string) => string | undefined = (id) => id): Promise<void> {
	const now = new Date().toISOString();

	// Merges first, outside the people transaction (mergePeople has its own).
	for (const wp of out.people ?? []) {
		const people = await db.people.toArray();
		const target =
			(wp.id && people.find((p) => p.id === wp.id)) ||
			matchPerson(people, wp.name, wp.relation) ||
			wp.aliases.map((a) => matchPerson(people, a, wp.relation)).find(Boolean);
		if (!target) continue;
		for (const mid of wp.merge_ids ?? []) if (mid !== target.id && people.some((p) => p.id === mid)) await mergePeople(target.id, mid);
		// Same name, different records (e.g. created before an alias was known)
		const twins = people.filter(
			(p) => p.id !== target.id && (normName(p.name) === normName(wp.name) || wp.aliases.some((a) => normName(a) === normName(p.name)))
		);
		for (const t of twins) if (await db.people.get(t.id)) await mergePeople(target.id, t.id);
	}

	await db.transaction('rw', [db.people, db.threads, db.fragments, db.settings], async () => {
		const people = await db.people.toArray();
		const known = new Set(people.map((p) => p.id));
		for (const wp of out.people ?? []) {
			let p =
				(wp.id && known.has(wp.id) ? people.find((x) => x.id === wp.id) : undefined) ??
				(await upsertPerson(people, wp.name, wp.relation, now, wp.aliases));
			p = people.find((x) => x.id === p!.id) ?? p;
			p.aliases = unionAliases(p.aliases, wp.aliases, [wp.name]);
			if (wp.relation !== 'unknown') p.relation = wp.relation;
			if (wp.summary) p.summary = wp.summary.slice(0, 80);
			if (wp.why) p.why = wp.why;
			if (wp.suggest_circle && p.circle !== 'in' && p.circle !== 'out') p.circle = 'suggested';
			await db.people.put(p);
		}

		const threads = await db.threads.toArray();
		const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
		for (const wt of out.threads ?? []) {
			if (!norm(wt.title)) continue;
			const personIds: string[] = [];
			for (const n of wt.people ?? []) {
				const m = matchPerson(people, n);
				if (m && !personIds.includes(m.id)) personIds.push(m.id);
			}
			const fragmentIds = (wt.note_ids ?? []).map(noteId).filter((x): x is string => !!x);
			const t = threads.find((x) => norm(x.title) === norm(wt.title));
			if (t) {
				t.personIds = [...new Set([...t.personIds, ...personIds])];
				t.fragmentIds = [...new Set([...t.fragmentIds, ...fragmentIds])];
				if (wt.status === 'done' && t.status === 'open') t.status = 'done';
				t.updatedAt = now;
				await db.threads.put(t);
			} else if (wt.status === 'open') {
				const nt: Thread = {
					id: newId(),
					title: wt.title.trim(),
					kind: wt.kind,
					personIds,
					fragmentIds,
					status: 'open',
					dueDay: null,
					createdAt: now,
					updatedAt: now
				};
				threads.push(nt);
				await db.threads.add(nt);
			}
		}

		const s = await readSettings();
		await db.settings.put({ ...s, lastWeaveAt: now, notesSinceWeave: 0, weaveFailedAt: undefined, weaveRetryAt: undefined, weaveFails: 0, weaveBusy: 0 });
	});
}
