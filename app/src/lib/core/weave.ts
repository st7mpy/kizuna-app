// The long-context pass: who matters right now, which names are the same person, open threads.
import type { Settings, Thread, WeaveOutput } from '@kizuna/shared';
import { db, newId, readSettings } from '../db.ts';
import { addDays, dayToDate, localDay } from './days.ts';
import { matchPerson, mergePeople, normName, unionAliases, upsertPerson } from './people.ts';
import { RelayError, isOnline, spark } from './relay.ts';
import { updateSettings } from './settings.ts';

export const WEAVE_NOTE_DAYS = 60;
export const WEAVE_NOTE_CAP = 200;

/** After a failed weave, wait this long before trying again (it is the most costly call). */
export const WEAVE_FAIL_WAIT_MS = 6 * 3600_000;

/** Due when 10+ notes arrived, or a day has passed and 3+ arrived; never within 6 h of a failure. */
export function weaveDue(s: Pick<Settings, 'lastWeaveAt' | 'notesSinceWeave' | 'weaveFailedAt'>, now = new Date()): boolean {
	if (s.weaveFailedAt && now.getTime() - new Date(s.weaveFailedAt).getTime() < WEAVE_FAIL_WAIT_MS) return false;
	const n = s.notesSinceWeave ?? 0;
	if (n >= 10) return true;
	const dayPassed = !s.lastWeaveAt || now.getTime() - new Date(s.lastWeaveAt).getTime() > 24 * 3600_000;
	return dayPassed && n >= 3;
}

let weaving: Promise<void> | null = null;

/** Long-context pass. Runs when due (daily or 10+ new notes) unless force. */
export function runWeave(force = false): Promise<void> {
	weaving ??= (async () => {
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
			let out: WeaveOutput;
			try {
				out = await spark('weave', {
					today: localDay(),
					notes: notes.map((f) => ({ id: f.id, day: localDay(f.createdAt), text: f.text })),
					people: people.map((p) => ({ id: p.id, name: p.name, aliases: p.aliases, relation: p.relation, circle: p.circle }))
				});
			} catch (e) {
				// Offline is not a failure; anything else backs off for 6 h.
				if (!(e instanceof RelayError && e.isConnectivity)) await updateSettings({ weaveFailedAt: new Date().toISOString() });
				throw e;
			}
			await applyWeave(out);
		} finally {
			weaving = null;
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
		await db.settings.put({ ...s, lastWeaveAt: now, notesSinceWeave: 0, weaveFailedAt: undefined });
	});
}
