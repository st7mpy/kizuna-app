// The Kizuna map: you in the centre, family on the inner ring, friends outside.
// Rings come from the relationship, never from how often you talk.
import type { CircleWindow, Occasion, Person, Relation, Settings } from '@kizuna/shared';
import { db, readSettings, type MemberRow } from '../db.ts';
import { deviceTimeZone, localDay } from './days.ts';
import { occasionsBetween } from './occasions.ts';
import { daylightAt, zonedClock, zonedMinutes } from './zones.ts';

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
}

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

/** A status counts only until it expires (and never longer than 12 h from when it was written). */
export function glowOf(m: MemberRow | undefined, now: number): 'open' | 'maybe' | null {
	const e = m?.entry;
	if (!e?.status || !e.statusUntil) return null;
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

	const people = i.people
		.filter((p) => p.circle === 'in')
		.sort(
			(a, b) =>
				Number(ringOf(a) === 'outer') - Number(ringOf(b) === 'outer') ||
				b.mentions - a.mentions ||
				a.name.localeCompare(b.name)
		)
		.slice(0, MAP_MAX_PEOPLE)
		.map((person): MapPerson => {
			const m = byPerson.get(person.id);
			const tz = m?.entry.tz ?? null;
			const localTime = tz ? zonedClock(nowMs, tz) : null;
			return {
				person,
				ring: ringOf(person),
				tz: localTime ? tz : null,
				localTime,
				daylight: localTime && tz ? daylightAt(zonedMinutes(nowMs, tz)) : 0,
				glow: sharing ? glowOf(m, nowMs) : null,
				windows: (m?.entry.windows ?? []).filter((w) => Date.parse(w.end) > nowMs),
				occasion: occasions.find((o) => o.personIds.includes(person.id)) ?? null,
				hasGift: i.giftPersonIds.has(person.id),
				hasNotes: i.notePersonIds.has(person.id),
				memberId: m?.memberId ?? null
			};
		});

	return {
		me: { name: i.settings.myName, tz: i.timeZone, localTime: zonedClock(nowMs, i.timeZone) ?? '' },
		people,
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
