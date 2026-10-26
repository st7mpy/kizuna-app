// Talk -> Remember: save the note at once, understand it in the background.
import type { ExtractOutput, Fragment, KEvent, Person, Source, Thread } from '@kizuna/shared';
import { guardDate } from '@kizuna/shared';
import { db, newId, readSettings } from '../db.ts';
import { localDay, weekdayName } from './days.ts';
import { upsertPerson } from './people.ts';
import { RelayError, isOnline, spark } from './relay.ts';
import { runWeave, weaveDue } from './weave.ts';

export const MAX_TRIES = 3;

/** Test hooks: backoff wait between tries. */
export const captureConfig = {
	sleep: (ms: number) => new Promise<void>((r) => setTimeout(r, ms)),
	backoffMs: (tries: number) => 1500 * 2 ** (tries - 1)
};

let onlineHooked = false;
function hookOnline() {
	if (onlineHooked || typeof window === 'undefined') return;
	onlineHooked = true;
	window.addEventListener('online', () => {
		void processPending();
	});
}

/** Save a note at once (never waits for the model), then process it in the background. */
export async function saveFragment(text: string, source: Source): Promise<Fragment> {
	const f: Fragment = {
		id: newId(),
		text: text.trim(),
		createdAt: new Date().toISOString(),
		source,
		status: 'new',
		tries: 0
	};
	await db.fragments.add(f);
	hookOnline();
	void processPending().catch(() => {});
	return f;
}

/** Date guard, but never let a guard failure lose an event. */
function safeGuard(modelDay: string | null, dateText: string | null, today: string): Pick<KEvent, 'day' | 'dateConfidence'> {
	try {
		const g = guardDate(modelDay, dateText, today);
		return { day: g.day, dateConfidence: g.confidence };
	} catch {
		const ok = !!modelDay && /^\d{4}-\d{2}-\d{2}$/.test(modelDay);
		return { day: ok ? modelDay : null, dateConfidence: ok ? 'guess' : 'none' };
	}
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

export interface ApplyOptions {
	/** Skip the date guard (sample life, whose dates are already right). */
	trustDates?: boolean;
}

/**
 * Applies one extraction to the db: people, events, promise threads, other threads,
 * mention counts, and marks the note done. Shared by live capture and the sample life.
 */
export async function applyExtract(f: Fragment, out: ExtractOutput, opts: ApplyOptions = {}): Promise<void> {
	const today = localDay(f.createdAt);
	await db.transaction('rw', [db.people, db.events, db.threads, db.fragments], async () => {
		const people = await db.people.toArray();
		const ids = new Map<string, string>(); // lower name in this note -> person id
		const idFor = async (name: string, relation: Person['relation'] = 'unknown') => {
			const key = norm(name);
			if (!key) return null;
			const known = ids.get(key);
			if (known) return known;
			const p = await upsertPerson(people, name, relation, f.createdAt);
			ids.set(key, p.id);
			return p.id;
		};
		for (const p of out.people ?? []) await idFor(p.name, p.relation);

		const idsFor = async (names: (string | null)[]) => {
			const r: string[] = [];
			for (const n of names) {
				const id = n ? await idFor(n) : null;
				if (id && !r.includes(id)) r.push(id);
			}
			return r;
		};

		// Events (skip exact repeats: same people, same thing, same day)
		const existing = await db.events.toArray();
		for (const e of out.events ?? []) {
			const personIds = await idsFor(e.people ?? []);
			const d = opts.trustDates
				? { day: e.date, dateConfidence: e.date ? ('sure' as const) : ('none' as const) }
				: safeGuard(e.date, e.date_text, today);
			const dup = existing.find(
				(x) => norm(x.what) === norm(e.what) && x.day === d.day && x.personIds.join() === personIds.join()
			);
			if (dup) continue;
			const ev: KEvent = {
				id: newId(),
				personIds,
				what: e.what,
				kind: e.kind,
				day: d.day,
				time: e.time ?? null,
				dateText: e.date_text ?? null,
				dateConfidence: d.dateConfidence,
				fragmentId: f.id,
				createdAt: f.createdAt
			};
			existing.push(ev);
			await db.events.add(ev);
		}

		// Threads: promises and the rest, merged with an open thread of the same title
		const open = await db.threads.where('status').equals('open').toArray();
		const upsertThread = async (title: string, kind: Thread['kind'], personIds: string[]) => {
			if (!norm(title)) return;
			const t = open.find((x) => norm(x.title) === norm(title));
			if (t) {
				t.personIds = [...new Set([...t.personIds, ...personIds])];
				t.fragmentIds = [...new Set([...t.fragmentIds, f.id])];
				t.updatedAt = f.createdAt > t.updatedAt ? f.createdAt : t.updatedAt;
				await db.threads.put(t);
				return;
			}
			const nt: Thread = {
				id: newId(),
				title: title.trim(),
				kind,
				personIds,
				fragmentIds: [f.id],
				status: 'open',
				dueDay: null,
				createdAt: f.createdAt,
				updatedAt: f.createdAt
			};
			open.push(nt);
			await db.threads.add(nt);
		};
		for (const p of out.promises ?? []) await upsertThread(p.what, 'promise', await idsFor([p.person]));
		for (const t of out.threads ?? []) await upsertThread(t.title, t.kind, await idsFor(t.people ?? []));

		// Mentions
		const mentioned = [...new Set(ids.values())];
		for (const id of mentioned) {
			const p = people.find((x) => x.id === id)!;
			p.mentions += 1;
			if (!p.lastMentionedAt || f.createdAt > p.lastMentionedAt) p.lastMentionedAt = f.createdAt;
			await db.people.put(p);
		}

		await db.fragments.update(f.id, {
			status: 'done',
			language: out.language,
			sensitive: !!out.sensitive,
			personIds: mentioned
		});
	});
}

let running: Promise<void> | null = null;
let again = false;

/** Understand any unprocessed notes (extract + date guard + upsert). Safe to call often. */
export function processPending(): Promise<void> {
	if (running) {
		again = true;
		return running;
	}
	running = (async () => {
		try {
			do {
				again = false;
				await processOnce();
			} while (again);
		} finally {
			running = null;
		}
	})();
	return running;
}

async function processOnce(): Promise<void> {
	hookOnline();
	if (!isOnline()) return;
	const pending = (await db.fragments.where('status').equals('new').toArray()).sort((a, b) =>
		a.createdAt.localeCompare(b.createdAt)
	);
	let understood = 0;
	for (const f of pending) {
		const r = await understand(f);
		if (r === 'offline') break;
		if (r === 'done') understood++;
	}
	if (understood) {
		await db.transaction('rw', db.settings, async () => {
			const s = await readSettings();
			await db.settings.put({ ...s, notesSinceWeave: (s.notesSinceWeave ?? 0) + understood });
		});
		if (weaveDue(await readSettings())) await runWeave().catch(() => {});
	}
}

async function understand(f: Fragment): Promise<'done' | 'failed' | 'offline'> {
	let tries = f.tries ?? 0;
	while (tries < MAX_TRIES) {
		const people = await db.people.toArray();
		const day = localDay(f.createdAt);
		try {
			const out = await spark('extract', {
				text: f.text,
				today: day,
				weekday: weekdayName(day),
				knownPeople: people
					.filter((p) => p.circle !== 'out' || p.mentions > 0)
					.map((p) => ({ name: p.name, aliases: p.aliases, relation: p.relation }))
			});
			await applyExtract(f, out);
			return 'done';
		} catch (e) {
			if (e instanceof RelayError && e.isConnectivity) return 'offline';
			tries++;
			await db.fragments.update(f.id, { tries, status: tries >= MAX_TRIES ? 'failed' : 'new' });
			if (tries < MAX_TRIES) await captureConfig.sleep(captureConfig.backoffMs(tries));
		}
	}
	return 'failed';
}

/** Puts a failed note back in the queue (e.g. a "try again" tap). */
export async function retryFragment(id: string): Promise<void> {
	await db.fragments.update(id, { status: 'new', tries: 0 });
	void processPending().catch(() => {});
}
