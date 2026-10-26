// Talk -> Remember: save the note at once, understand it in the background.
import type { ExtractOutput, Fragment, GiftHint, KEvent, Person, Source, Thread } from '@kizuna/shared';
import { guardDate } from '@kizuna/shared';
import { db, newId, readSettings } from '../db.ts';
import { localDay, weekdayName } from './days.ts';
import { upsertPerson } from './people.ts';
import { looksSensitive } from './poke.ts';
import { RelayError, isOnline, spark } from './relay.ts';
import { runWeave, weaveDue } from './weave.ts';

export const MAX_TRIES = 3;
/** A failed note is tried again (3 more tries) at most once a day, on app open. */
export const FAILED_RETRY_MS = 24 * 3600_000;

/** Test hooks: wait before the next try, by tries so far (30 s, 2 min, 10 min). */
export const captureConfig = {
	backoffMs: (tries: number) => [30_000, 120_000, 600_000][Math.min(tries, 3) - 1] ?? 600_000
};

let retryTimer: ReturnType<typeof setTimeout> | undefined;
/** Wakes the queue when the next waiting note is due (while the app stays open). */
function scheduleRetry(at: number) {
	clearTimeout(retryTimer);
	retryTimer = setTimeout(() => void processPending().catch(() => {}), Math.max(1000, at - Date.now()));
}

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

/** A thought noted on a person's page: a normal note, tagged to them, understood like any other. */
export async function noteThought(personId: string, text: string, source: Source = 'typed'): Promise<Fragment> {
	const f: Fragment = {
		id: newId(),
		text: text.trim(),
		createdAt: new Date().toISOString(),
		source,
		status: 'new',
		tries: 0,
		personIds: [personId]
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
	await db.transaction('rw', [db.people, db.events, db.threads, db.fragments, db.gifts, db.occasions], async () => {
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
			// A dated birthday becomes an occasion for the person it is about (the first named).
			if (e.kind === 'birthday' && ev.day && personIds[0] && ev.dateConfidence !== 'none') {
				const who = people.find((p) => p.id === personIds[0]);
				if (who) {
					await db.occasions.put({
						id: `birthday:${who.id}`,
						day: ev.day,
						name: `${who.name}'s birthday`,
						kind: 'birthday',
						personIds: [who.id],
						fragmentId: f.id
					});
				}
			}
		}

		// Gift hints, matched to people like events are. Never money or health.
		const hints = await db.gifts.where('status').equals('open').toArray();
		for (const g of out.gift_hints ?? []) {
			const what = (g.what ?? '').trim().replace(/[.\s]+$/, '');
			if (!what || what.length > 120 || looksSensitive(what) || /(₹|\brs\.?\s?\d|\brupees?\b|\bprice\b|\bcost\b|https?:)/i.test(what)) continue;
			const personId = g.person ? await idFor(g.person) : null;
			if (!personId) continue;
			if (hints.some((h) => h.personId === personId && norm(h.what) === norm(what))) continue;
			const hint: GiftHint = { id: newId(), personId, what, fragmentId: f.id, createdAt: f.createdAt, status: 'open' };
			hints.push(hint);
			await db.gifts.add(hint);
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
			// keep a person the note was tagged to (a thought noted on someone's page)
			personIds: [...new Set([...(f.personIds ?? []), ...mentioned])]
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
	const now = Date.now();
	const queued = await db.fragments.where('status').equals('new').toArray();
	const due = (f: Fragment) => !f.nextTryAt || Date.parse(f.nextTryAt) <= now;
	const pending = queued.filter(due).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
	let understood = 0;
	for (const f of pending) {
		const r = await understand(f);
		if (r === 'pause') {
			// The relay is busy or slow: look again in a couple of minutes (the online event covers offline).
			if (isOnline()) scheduleRetry(Date.now() + 120_000);
			return;
		}
		if (r === 'done') understood++;
	}
	const waiting = (await db.fragments.where('status').equals('new').toArray())
		.map((f) => (f.nextTryAt ? Date.parse(f.nextTryAt) : NaN))
		.filter((t) => t > Date.now());
	if (waiting.length) scheduleRetry(Math.min(...waiting));
	if (understood) {
		await db.transaction('rw', db.settings, async () => {
			const s = await readSettings();
			await db.settings.put({ ...s, notesSinceWeave: (s.notesSinceWeave ?? 0) + understood });
		});
		if (weaveDue(await readSettings())) await runWeave().catch(() => {});
	}
}

/**
 * One try. Offline, timeouts and rate limits are not the note's fault: stop the queue,
 * don't count a try. Other errors count, and the next try waits longer.
 */
async function understand(f: Fragment): Promise<'done' | 'later' | 'failed' | 'pause'> {
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
		if (e instanceof RelayError && e.isTransient) return 'pause';
		const tries = (f.tries ?? 0) + 1;
		const failed = tries >= MAX_TRIES;
		const wait = failed ? FAILED_RETRY_MS : captureConfig.backoffMs(tries);
		await db.fragments.update(f.id, { tries, status: failed ? 'failed' : 'new', nextTryAt: new Date(Date.now() + wait).toISOString() });
		return failed ? 'failed' : 'later';
	}
}

/** Puts a failed note back in the queue (e.g. a "try again" tap). */
export async function retryFragment(id: string): Promise<void> {
	await db.fragments.update(id, { status: 'new', tries: 0, nextTryAt: undefined });
	void processPending().catch(() => {});
}

/** On app open: failed notes get a fresh set of tries, at most once a day each. */
export async function requeueFailed(now = Date.now()): Promise<number> {
	const failed = await db.fragments.where('status').equals('failed').toArray();
	const ready = failed.filter((f) => !f.nextTryAt || Date.parse(f.nextTryAt) <= now);
	for (const f of ready) await db.fragments.update(f.id, { status: 'new', tries: 0, nextTryAt: undefined });
	return ready.length;
}
