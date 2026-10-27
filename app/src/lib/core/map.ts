// The Kizuna map: you in the centre, family on the inner ring, friends outside.
// Rings come from the relationship, never from how often you talk.
import type { CircleWindow, Occasion, Person, Relation, Settings } from '@kizuna/shared';
import { db, readSettings, type MemberRow } from '../db.ts';
import { deviceTimeZone, localDay } from './days.ts';
import { occasionsBetween } from './occasions.ts';
import { daylightAt, quietAt, zonedClock, zonedMinutes } from './zones.ts';

export const MAP_MAX_PEOPLE = 8;
export const MAP_OCCASION_DAYS = 14;
const INNER: Relation[] = ['parent', 'sibling', 'partner', 'child', 'family'];

export interface MapPerson {
	person: Person;
	ring: 'inner' | 'outer';
	tz: string | null; // null = not known (they haven't joined the circle)
	localTime: string | null; // 'HH:MM' at their end
	daylight: number; // 0 night .. 1 midday, at their end
	glow: 'open' | 'maybe' | null;
	windows: CircleWindow[];
	occasion: Occasion | null; // theirs, within 14 days
	hasGift: boolean;
	hasNotes: boolean;
	memberId: string | null;
	/**
	 * Someone who answered on the family page but isn't linked to anyone here yet. `person` is a
	 * stand-in made from their answer (id `member:<memberId>`); the map asks "Who is this?".
	 */
	unlinked?: boolean;
	/** Index into the map's colours (ui/hue.ts HUES). No two people on the map share one. */
	hue: number;
}

export const HUE_COUNT = 8;
let mapHues = new Map<string, number>();
/** The colour index the map last gave this person (so lists and pages match the map), or null. */
export function mapHueIndex(id: string): number | null {
	return mapHues.get(id) ?? null;
}
const nameHash = (name: string) => {
	let h = 2166136261;
	const t = name.trim().toLowerCase();
	for (let i = 0; i < t.length; i++) {
		h ^= t.charCodeAt(i);
		h = Math.imul(h, 16777619);
	}
	return h >>> 0;
};

/**
 * Pure: a colour for each person on the map, none repeated (up to HUE_COUNT people). Each person
 * keeps the colour their name picks unless someone added earlier already has it; then the next free one.
 * The same family gets the same colours on every load.
 */
export function assignHues(people: { id: string; name: string; createdAt?: string }[]): Map<string, number> {
	const out = new Map<string, number>();
	const taken = new Set<number>();
	const order = [...people].sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? '') || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
	for (const p of order) {
		let h = nameHash(p.name) % HUE_COUNT;
		if (taken.size < HUE_COUNT) while (taken.has(h)) h = (h + 1) % HUE_COUNT;
		taken.add(h);
		out.set(p.id, h);
	}
	return out;
}

/** Shown at most this many unlinked answers, so they never crowd out the people you keep. */
export const MAP_MAX_UNLINKED = 3;
export const UNLINKED_PREFIX = 'member:';

export interface MapView {
	me: { name: string; tz: string; localTime: string };
	people: MapPerson[];
	occasions: Occasion[];
	/** True while I share my own entry; others' glow only shows then. */
	sharing: boolean;
}

export function ringOf(p: Person): 'inner' | 'outer' {
	return INNER.includes(p.relation) ? 'inner' : 'outer';
}

/** Reciprocity: you see others' glow only while you share yours. */
export function isSharing(s: Pick<Settings, 'circle'>): boolean {
	return !!s.circle && s.circle.share && !s.circle.paused;
}

/**
 * A status counts only until it expires (and never longer than 12 h from when it was written),
 * and never inside their quiet hours: nobody is "open to a call" at 4 in the morning.
 */
export function glowOf(m: Pick<MemberRow, 'entry'> | undefined, now: number): 'open' | 'maybe' | null {
	const e = m?.entry;
	if (!e?.status || !e.statusUntil) return null;
	if (e.tz && quietAt(now, e.tz, e.quietStart || undefined, e.quietEnd || undefined)) return null;
	let until = Date.parse(e.statusUntil);
	const written = Date.parse(e.updatedAt);
	if (Number.isFinite(written)) until = Math.min(until, written + 12 * 3600_000);
	if (!(until > now)) return null;
	return e.status === 'free' ? 'open' : 'maybe';
}

export interface MapInputs {
	now: Date;
	settings: Settings;
	people: Person[];
	members: MemberRow[];
	personal: Occasion[];
	giftPersonIds: Set<string>;
	notePersonIds: Set<string>;
	timeZone: string;
}

/** Pure: the map from its inputs. */
export function mapView(i: MapInputs): MapView {
	const nowMs = i.now.getTime();
	const sharing = isSharing(i.settings);
	const today = localDay(i.now);
	const occasions = occasionsBetween(i.personal, today, MAP_OCCASION_DAYS);
	const byPerson = new Map<string, MemberRow>();
	for (const m of i.members) if (m.personId && !byPerson.has(m.personId)) byPerson.set(m.personId, m);

	const memberDot = (m: MemberRow, person: Person, unlinked: boolean): Omit<MapPerson, 'occasion' | 'hasGift' | 'hasNotes' | 'hue'> => {
		const tz = m?.entry.tz ?? null;
		const localTime = tz ? zonedClock(nowMs, tz) : null;
		return {
			person,
			ring: unlinked ? 'outer' : ringOf(person),
			tz: localTime ? tz : null,
			localTime,
			daylight: localTime && tz ? daylightAt(zonedMinutes(nowMs, tz)) : 0,
			glow: sharing ? glowOf(m, nowMs) : null,
			windows: (m?.entry.windows ?? []).filter((w) => Date.parse(w.end) > nowMs),
			memberId: m?.memberId ?? null,
			...(unlinked ? { unlinked: true } : {})
		};
	};
	// Answers nobody here is linked to yet (and the user hasn't said "not someone I know").
	const unlinked = i.members
		.filter((m) => !m.personId && m.linkedBy !== 'user' && m.entry?.name?.trim())
		.sort((a, b) => (b.answeredAt ?? b.entry.updatedAt).localeCompare(a.answeredAt ?? a.entry.updatedAt))
		.slice(0, MAP_MAX_UNLINKED)
		.map((m): MapPerson => {
			const person: Person = {
				id: UNLINKED_PREFIX + m.memberId,
				name: m.entry.name.trim(),
				aliases: [],
				relation: 'unknown',
				circle: 'none',
				mentions: 0,
				createdAt: m.fetchedAt
			};
			return { ...memberDot(m, person, true), occasion: null, hasGift: false, hasNotes: false, hue: 0 };
		});

	const people = i.people
		.filter((p) => p.circle === 'in')
		.sort(
			(a, b) =>
				Number(ringOf(a) === 'outer') - Number(ringOf(b) === 'outer') ||
				b.mentions - a.mentions ||
				a.name.localeCompare(b.name)
		)
		.slice(0, MAP_MAX_PEOPLE - unlinked.length)
		.map((person): MapPerson => {
			const m = byPerson.get(person.id);
			return {
				...memberDot(m as MemberRow, person, false),
				occasion: occasions.find((o) => o.personIds.includes(person.id)) ?? null,
				hasGift: i.giftPersonIds.has(person.id),
				hasNotes: i.notePersonIds.has(person.id),
				hue: 0
			};
		});
	const all = [...people, ...unlinked];
	const hues = assignHues(all.map((m) => m.person));
	for (const m of all) m.hue = hues.get(m.person.id) ?? 0;
	mapHues = hues;

	return {
		me: { name: i.settings.myName, tz: i.timeZone, localTime: zonedClock(nowMs, i.timeZone) ?? '' },
		people: all,
		occasions,
		sharing
	};
}

/** Reads the db and builds the map. */
export async function buildMapView(now = new Date()): Promise<MapView> {
	const [settings, people, members, personal, gifts] = await Promise.all([
		readSettings(),
		db.people.toArray(),
		db.members.toArray(),
		db.occasions.toArray(),
		db.gifts.where('status').equals('open').toArray()
	]);
	const circleIds = people.filter((p) => p.circle === 'in').map((p) => p.id);
	const withNotes = new Set<string>();
	for (const id of circleIds) if ((await db.fragments.where('personIds').equals(id).count()) > 0) withNotes.add(id);
	return mapView({
		now,
		settings,
		people,
		members,
		personal: personal.map(({ id: _id, fragmentId: _f, ...o }) => o),
		giftPersonIds: new Set(gifts.map((g) => g.personId)),
		notePersonIds: withNotes,
		timeZone: deviceTimeZone()
	});
}
