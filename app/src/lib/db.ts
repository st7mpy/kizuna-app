// The phone's database. Notes and people never leave the device except as task inputs.
import { Dexie, liveQuery, type EntityTable } from 'dexie';
import type { CircleEntry, Fragment, GiftHint, KEvent, Occasion, Person, Prompt, Settings, Thread, Window } from '@kizuna/shared';
import { buildMapView, type MapView } from './core/map.ts';
import { setHomeZone } from './core/days.ts';
export type { MapView, MapPerson } from './core/map.ts';

/** A circle member as last fetched (opened on the phone). Mine is never stored here. */
export interface MemberRow {
	memberId: string;
	personId: string | null; // the Person this member is, once linked
	linkedBy?: 'auto' | 'user';
	entry: CircleEntry;
	fetchedAt: string;
	reply?: string; // the words they replied with, when known (e.g. a WhatsApp reply)
	/** When a family-page answer from them was new or changed (set by the circle refresh). */
	answeredAt?: string;
	/** The user closed the "answered" line on Today for this answer. */
	answerSeen?: boolean;
}

/** A personal occasion heard in notes (birthdays); festivals live in a fixed table. */
export interface StoredOccasion extends Occasion {
	id: string;
	fragmentId?: string;
}

export class KizunaDB extends Dexie {
	fragments!: EntityTable<Fragment, 'id'>;
	people!: EntityTable<Person, 'id'>;
	events!: EntityTable<KEvent, 'id'>;
	threads!: EntityTable<Thread, 'id'>;
	prompts!: EntityTable<Prompt, 'id'>;
	settings!: EntityTable<Settings, 'id'>;
	gifts!: EntityTable<GiftHint, 'id'>;
	members!: EntityTable<MemberRow, 'memberId'>;
	occasions!: EntityTable<StoredOccasion, 'id'>;

	constructor() {
		super('kizuna');
		this.version(1).stores({
			fragments: 'id, createdAt, status, *personIds',
			people: 'id, circle, name, *aliases',
			events: 'id, day, *personIds, fragmentId',
			threads: 'id, status, kind, *personIds, updatedAt',
			prompts: 'id, shownAt, personId, threadId',
			settings: 'id'
		});
		this.version(2).stores({
			gifts: 'id, personId, status',
			members: 'memberId, personId',
			occasions: 'id, day, *personIds'
		});
	}
}

export const db = new KizunaDB();

export const newId = (): string => crypto.randomUUID();

const weekdayEvening = (day: number): Window => ({ day, start: '18:30', end: '21:30' });

export function defaultSettings(): Settings {
	let timeZone = 'UTC';
	try {
		timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
	} catch {
		/* keep UTC */
	}
	return {
		id: 'me',
		myName: '',
		freeHours: [
			...[1, 2, 3, 4, 5].map(weekdayEvening),
			...[0, 6].flatMap((day) => [
				{ day, start: '10:00', end: '13:00' },
				{ day, start: '16:00', end: '20:00' }
			])
		],
		quietStart: '21:30',
		quietEnd: '08:30',
		weeklyCap: 5,
		languageBias: ['en', 'hi'],
		timeZone,
		notesSinceWeave: 0
	};
}

export async function readSettings(): Promise<Settings> {
	const s = await db.settings.get('me');
	const d = defaultSettings();
	// The zone is the phone's current one, never a saved copy, unless a sample family has a home city.
	setHomeZone(s?.homeTz);
	return s ? { ...d, ...s, timeZone: s.homeTz || d.timeZone } : d;
}

// ---------- live queries for the UI (Svelte can use these as stores with $) ----------

const byName = (a: Person, b: Person) => a.name.localeCompare(b.name);

export const circlePeople = () =>
	liveQuery(async () => (await db.people.where('circle').equals('in').toArray()).sort(byName));

export const suggestedPeople = () =>
	liveQuery(async () =>
		(await db.people.where('circle').equals('suggested').toArray()).sort((a, b) => b.mentions - a.mentions)
	);

/** Everyone Kizuna knows, most mentioned first. */
export const allPeople = () =>
	liveQuery(async () => (await db.people.toArray()).sort((a, b) => b.mentions - a.mentions || byName(a, b)));

export const person = (id: string) => liveQuery(() => db.people.get(id));

/** A person's events, soonest/latest first (undated last). */
export const eventsFor = (personId: string) =>
	liveQuery(async () =>
		(await db.events.where('personIds').equals(personId).toArray()).sort((a, b) =>
			(b.day ?? '').localeCompare(a.day ?? '')
		)
	);

export const fragmentsMentioning = (personId: string) =>
	liveQuery(async () =>
		(await db.fragments.where('personIds').equals(personId).toArray()).sort((a, b) =>
			b.createdAt.localeCompare(a.createdAt)
		)
	);

export const openThreads = () =>
	liveQuery(async () =>
		(await db.threads.where('status').equals('open').toArray()).sort((a, b) =>
			b.updatedAt.localeCompare(a.updatedAt)
		)
	);

export const threadsFor = (personId: string) =>
	liveQuery(() => db.threads.where('personIds').equals(personId).toArray());

/** Newest notes first. */
export const recentFragments = (limit = 50) =>
	liveQuery(() => db.fragments.orderBy('createdAt').reverse().limit(limit).toArray());

/** Notes not yet understood (still 'new'), for a quiet "will sort this soon" hint. */
export const pendingCount = () => liveQuery(() => db.fragments.where('status').equals('new').count());

export const settingsLive = () => liveQuery(readSettings);

export const fragment = (id: string) => liveQuery(() => db.fragments.get(id));

/** True once there is any note (for first-run screens). */
export const hasAnyData = () => liveQuery(async () => (await db.fragments.count()) > 0);

// ---------- the Kizuna map ----------

/** Circle members as last fetched. */
export const circleMembers = () => liveQuery(() => db.members.toArray());

/** Gift hints for one person (open first, newest first). */
export const giftsFor = (personId: string) =>
	liveQuery(async () =>
		(await db.gifts.where('personId').equals(personId).toArray()).sort(
			(a, b) => Number(b.status === 'open') - Number(a.status === 'open') || b.createdAt.localeCompare(a.createdAt)
		)
	);

/**
 * The map: updates on any change, and once a minute so local times and glows stay right.
 * Works as a Svelte store ($map) and as an observable.
 */
export function mapLive(): { subscribe(next: ((v: MapView) => void) | { next: (v: MapView) => void }): { unsubscribe(): void } } {
	return {
		subscribe(observer) {
			const next = typeof observer === 'function' ? observer : (v: MapView) => observer.next(v);
			let closed = false;
			const sub = liveQuery(() => buildMapView()).subscribe({ next: (v) => !closed && next(v), error: () => {} });
			const timer = setInterval(() => {
				void buildMapView().then((v) => !closed && next(v)).catch(() => {});
			}, 60_000);
			return {
				unsubscribe() {
					closed = true;
					clearInterval(timer);
					sub.unsubscribe();
				}
			};
		}
	};
}
