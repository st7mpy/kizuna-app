// The circle on this phone: create, invite, publish my sealed entry, fetch and open the others.
// The key never goes to the server (only into links, after '#').
import type { CircleEntry, CircleState, CircleWindow, CreateCircleResponse, Person, Settings, Window } from '@kizuna/shared';
import {
	CIRCLE_LIMITS,
	circleLink as buildCircleLink,
	newCircleKey,
	openEntry,
	randomId,
	sealEntry,
	slotAddDays,
	slotWeekday,
	zonedDay,
	zonedIso,
	zonedToUtc
} from '@kizuna/shared';
import { db, readSettings, type MemberRow } from '../db.ts';
import { deviceTimeZone, localDay } from './days.ts';
import { matchPerson } from './people.ts';
import { RelayError, isOnline, relayJson } from './relay.ts';
import { updateSettings } from './settings.ts';
import { busyTimes } from './time.ts';
import { answerStamp } from './answers.ts';

export const SAMPLE_CIRCLE_ID = 'sample';
export const MIN_WINDOW_MINUTES = 45;
type Busy = { start: string; end: string };
type CircleSettings = NonNullable<Settings['circle']>;

const firstName = (s: Pick<Settings, 'myName'>) => (s.myName || '').trim().split(/\s+/)[0] || '';
const isSample = (c: CircleSettings | undefined) => c?.id === SAMPLE_CIRCLE_ID;
/** Sample-life members are written on the phone only and survive a refresh. */
export const isSampleMember = (m: Pick<MemberRow, 'memberId'>) => m.memberId.startsWith('sample-');

// ---------- windows (pure) ----------

const hhmm = (s: string) => {
	const m = /^(\d{1,2}):(\d{2})$/.exec(s);
	return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

/**
 * Free windows from weekly free hours minus busy times, on local days [fromDay, toDay] in `tz`,
 * starting no earlier than `nowMs`. Each window at least `minMinutes` long. Earliest first.
 */
export function freeWindows(q: {
	freeHours: Window[];
	busy: Busy[];
	nowMs: number;
	timeZone: string;
	fromDay: string;
	toDay: string;
	minMinutes?: number;
	/** Only after this instant / before this instant (e.g. the weekend). */
	notBefore?: number;
	notAfter?: number;
}): CircleWindow[] {
	const min = (q.minMinutes ?? MIN_WINDOW_MINUTES) * 60_000;
	const busy = q.busy.map((b) => [Date.parse(b.start), Date.parse(b.end)] as const).filter(([s, e]) => e > s);
	const segs: [number, number][] = [];
	for (let day = q.fromDay, i = 0; day <= q.toDay && i < 15; day = slotAddDays(day, 1), i++) {
		const wd = slotWeekday(day);
		for (const w of q.freeHours.filter((x) => x.day === wd)) {
			const s = hhmm(w.start);
			let e = hhmm(w.end);
			if (s == null || e == null) continue;
			if (e <= s) e += 24 * 60;
			const a = zonedToUtc(day, s, q.timeZone) ?? zonedToUtc(day, s + 60, q.timeZone);
			const b = zonedToUtc(day, e, q.timeZone) ?? zonedToUtc(day, e + 60, q.timeZone);
			if (a == null || b == null) continue;
			let pieces: [number, number][] = [[Math.max(a, q.nowMs, q.notBefore ?? -Infinity), Math.min(b, q.notAfter ?? Infinity)]];
			for (const [bs, be] of busy) {
				pieces = pieces.flatMap(([ps, pe]): [number, number][] =>
					bs >= pe || be <= ps ? [[ps, pe]] : ([[ps, bs], [be, pe]] as [number, number][]).filter(([x, y]) => y > x)
				);
			}
			for (const p of pieces) if (p[1] - p[0] >= min) segs.push(p);
		}
	}
	segs.sort((x, y) => x[0] - y[0]);
	return segs.map(([s, e]) => ({ start: zonedIso(s, q.timeZone), end: zonedIso(e, q.timeZone) }));
}

const isWeekendWindow = (w: CircleWindow, tz: string) => {
	const ms = Date.parse(w.start);
	const wd = slotWeekday(zonedDay(ms, tz));
	return wd === 0 || wd === 6 || (wd === 5 && w.start.slice(11, 13) >= '18');
};

/** Pure: up to 3 windows in the next 7 days to share, weekend ones first, shown in time order. */
export function pickShareWindows(all: CircleWindow[], tz: string, max: number = CIRCLE_LIMITS.maxWindows): CircleWindow[] {
	const weekend = all.filter((w) => isWeekendWindow(w, tz));
	const rest = all.filter((w) => !isWeekendWindow(w, tz));
	return [...weekend, ...rest].slice(0, max).sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
}

/** Pure: my entry as the others will see it. Paused is handled by the caller (deleted, not written). */
export function buildMyEntry(s: Settings, now: Date, busy: Busy[], timeZone: string): CircleEntry {
	const c = s.circle;
	const nowMs = now.getTime();
	const share = !!c?.share && !c.paused;
	const today = zonedDay(nowMs, timeZone);
	const windows = share
		? pickShareWindows(
				freeWindows({ freeHours: s.freeHours, busy, nowMs, timeZone, fromDay: today, toDay: slotAddDays(today, 7), notAfter: nowMs + 7 * 86_400_000 }),
				timeZone
			)
		: [];
	let status: CircleEntry['status'] = null;
	let statusUntil: string | null = null;
	const tapped = s.room && s.room.day === localDay(now) ? s.room.level : null;
	if (share && c?.freeToday && (tapped === 'lots' || tapped === 'some')) {
		status = tapped === 'lots' ? 'free' : 'maybe';
		const midnight = zonedToUtc(slotAddDays(today, 1), 0, timeZone) ?? nowMs + 12 * 3600_000;
		statusUntil = new Date(Math.min(nowMs + CIRCLE_LIMITS.statusMaxHours * 3600_000, midnight)).toISOString();
	}
	return {
		v: 1,
		name: (firstName(s) || 'Me').slice(0, 40),
		tz: timeZone,
		status,
		statusUntil,
		windows,
		quietStart: s.quietStart,
		quietEnd: s.quietEnd,
		via: 'app',
		updatedAt: now.toISOString()
	};
}

// ---------- the circle ----------

function origin(s: Settings): string {
	return s.relayUrl?.replace(/\/+$/, '') || (typeof location !== 'undefined' ? location.origin : '');
}

/** Creates a new circle and joins it (sharing my windows, "free today" off until the user turns it on). */
export async function createCircle(): Promise<CircleSettings> {
	const r = await relayJson<CreateCircleResponse>('/api/circle', { body: {}, timeoutMs: 15_000 });
	const prev = (await readSettings()).circle;
	const circle: CircleSettings = {
		id: r.id,
		key: newCircleKey(),
		memberId: randomId(12),
		share: prev?.share ?? true,
		freeToday: prev?.freeToday ?? false,
		paused: prev?.paused ?? false
	};
	await updateSettings({ circle });
	await publishMyEntry().catch(() => {});
	return circle;
}

/** The family-page link for my circle, or null when there is none yet. */
export async function circleLink(): Promise<string | null> {
	const s = await readSettings();
	if (!s.circle || isSample(s.circle)) return null;
	return buildCircleLink(origin(s), s.circle.id, s.circle.key, firstName(s) || undefined);
}

/** A fresh link (new circle and key). Old entries simply expire; the old link stops showing anything new. */
export async function newCircleLink(): Promise<string> {
	await db.members.filter((m) => !isSampleMember(m)).delete();
	await createCircle();
	return (await circleLink())!;
}

/** My windows for the next 7 days, as they would be shared (for a preview). */
export async function myWindows(): Promise<CircleWindow[]> {
	const s = await readSettings();
	const tz = deviceTimeZone();
	return buildMyEntry({ ...s, circle: { ...(s.circle ?? { id: '', key: '', memberId: '', freeToday: false, paused: false }), share: true, paused: false } }, new Date(), await busyTimes(s), tz).windows;
}

/** Writes (or, while paused, deletes) my sealed entry. Nothing happens without a circle or offline. */
export async function publishMyEntry(): Promise<void> {
	const s = await readSettings();
	const c = s.circle;
	if (!c || isSample(c) || !isOnline()) return;
	const path = `/api/circle/${c.id}/m/${c.memberId}`;
	if (c.paused) {
		await relayJson(path, { method: 'DELETE', timeoutMs: 15_000 });
		return;
	}
	const entry = buildMyEntry(s, new Date(), c.share ? await busyTimes(s) : [], deviceTimeZone());
	const sealed = await sealEntry(c.key, c.id, c.memberId, entry);
	await relayJson(path, { method: 'PUT', body: sealed, timeoutMs: 15_000 });
}

/** Pure: who a member is among my people (by name or alias, circle in or suggested). */
export function autoLink(people: Person[], name: string): string | null {
	const pool = people.filter((p) => p.circle === 'in' || p.circle === 'suggested');
	return matchPerson(pool, name)?.id ?? null;
}

let refreshing: Promise<void> | null = null;

/** Fetches and opens everyone's entries, caches them, and links them to people. */
export function refreshCircle(): Promise<void> {
	refreshing ??= (async () => {
		try {
			const s = await readSettings();
			const c = s.circle;
			if (!c || isSample(c) || !isOnline()) return;
			let state: CircleState;
			try {
				state = await relayJson<CircleState>(`/api/circle/${c.id}`, { timeoutMs: 15_000 });
			} catch (e) {
				if (e instanceof RelayError && /status 404/.test(e.message)) await db.members.filter((m) => !isSampleMember(m)).delete(); // circle gone
				throw e;
			}
			const nowDate = new Date();
			const now = nowDate.toISOString();
			const [people, cached] = await Promise.all([db.people.toArray(), db.members.toArray()]);
			const opened: MemberRow[] = cached.filter(isSampleMember);
			const prev = new Map(cached.map((m) => [m.memberId, m]));
			for (const m of state.members ?? []) {
				if (m.memberId === c.memberId) continue;
				const entry = await openEntry(c.key, c.id, m.memberId, m);
				if (!entry) continue;
				const old = prev.get(m.memberId);
				const keep = old?.linkedBy === 'user' || (old?.personId && people.some((p) => p.id === old.personId));
				const personId = keep ? old!.personId : autoLink(people, entry.name);
				opened.push({
					...old,
					memberId: m.memberId,
					personId,
					linkedBy: keep ? old!.linkedBy : personId ? 'auto' : undefined,
					entry,
					fetchedAt: now,
					...answerStamp(old, entry, nowDate)
				});
			}
			await db.transaction('rw', db.members, async () => {
				await db.members.clear();
				await db.members.bulkPut(opened);
			});
			await updateSettings({ circle: { ...c, lastSyncAt: now } });
		} finally {
			refreshing = null;
		}
	})();
	return refreshing;
}

/** The user says who a member is (or null: not someone I know). */
export async function linkMember(memberId: string, personId: string | null): Promise<void> {
	await db.members.update(memberId, { personId, linkedBy: 'user' });
}

/** Leave: delete my entry, forget the circle and everyone's cached entries. */
export async function leaveCircle(): Promise<void> {
	const s = await readSettings();
	const c = s.circle;
	if (c && !isSample(c) && isOnline()) {
		await relayJson(`/api/circle/${c.id}/m/${c.memberId}`, { method: 'DELETE', timeoutMs: 15_000 }).catch(() => {});
	}
	await db.members.clear();
	await db.transaction('rw', db.settings, async () => {
		const cur = await readSettings();
		delete cur.circle;
		await db.settings.put(cur);
	});
}

/** Sharing toggles. Saves and republishes at once. */
export async function setSharing(patch: Partial<Pick<CircleSettings, 'share' | 'freeToday' | 'paused'>>): Promise<void> {
	const s = await readSettings();
	if (!s.circle) return;
	await updateSettings({ circle: { ...s.circle, ...patch } });
	await publishMyEntry().catch(() => {});
}

/** What in settings changes my entry (used to republish only when needed). */
export function entrySignature(s: Settings): string {
	const tapped = s.room && s.room.day === localDay() ? s.room.level : null;
	const c = s.circle;
	return JSON.stringify([c?.id, c?.memberId, c?.share, c?.freeToday, c?.paused, s.myName, s.freeHours, s.icalUrl, s.quietStart, s.quietEnd, tapped]);
}
