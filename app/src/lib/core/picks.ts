// Pick-a-time links the user shared: look for the other person's pick (on open, then every
// 60 s while the app is visible) and show it on Today, ready to add to the calendar.
import type { InviteState, PickInvite, Slot } from '@kizuna/shared';
import { googleCalendarLink } from '@kizuna/shared';
import { db, readSettings } from '../db.ts';
import { RelayError, isOnline, relayJson } from './relay.ts';
import { updateSettings } from './settings.ts';

export const PICK_POLL_MS = 60_000;
const KEEP = 12;
const DAY = 24 * 3600_000;

/** Pure: invites still waiting for a pick. */
export function openInvites(list: PickInvite[], now = Date.now()): PickInvite[] {
	return list.filter((i) => i.pickedIndex == null && Date.parse(i.expiresAt) > now);
}

/** Remembers a shared link. Old, expired and long-past picks are dropped. */
export async function recordInvite(inv: Omit<PickInvite, 'createdAt' | 'expiresAt'> & { createdAt?: string; expiresAt?: string }, now = Date.now()): Promise<void> {
	await db.transaction('rw', db.settings, async () => {
		const s = await readSettings();
		const entry: PickInvite = {
			createdAt: new Date(now).toISOString(),
			expiresAt: new Date(now + 7 * DAY).toISOString(),
			pickedIndex: null,
			...inv
		};
		const kept = (s.pickInvites ?? []).filter((i) => i.id !== inv.id && !stale(i, now));
		await db.settings.put({ ...s, pickInvites: [entry, ...kept].slice(0, KEEP) });
	});
	kick();
}

function stale(i: PickInvite, now: number): boolean {
	if (i.pickedIndex == null) return Date.parse(i.expiresAt) <= now;
	const slot = i.slots[i.pickedIndex];
	return !slot || Date.parse(slot.end) + DAY < now;
}

/** Asks the relay about each open invite once. Returns how many new picks it found. */
export async function checkInvites(now = Date.now()): Promise<number> {
	if (!isOnline()) return 0;
	const s = await readSettings();
	const open = openInvites(s.pickInvites ?? [], now);
	if (!open.length) return 0;
	const found = new Map<string, { pickedIndex?: number; gone?: boolean }>();
	for (const inv of open) {
		try {
			const st = await relayJson<InviteState>(`/api/invite/${encodeURIComponent(inv.id)}`, { timeoutMs: 10_000 });
			if (typeof st?.pickedIndex === 'number' && inv.slots[st.pickedIndex]) found.set(inv.id, { pickedIndex: st.pickedIndex });
		} catch (e) {
			// An ended or unknown invite stops being asked about; anything else waits for the next round.
			if (e instanceof RelayError && e.code === 'http' && /status 404/.test(e.message)) found.set(inv.id, { gone: true });
			else if (e instanceof RelayError && (e.code === 'offline' || e.code === 'rate_limited')) break;
		}
	}
	if (!found.size) return 0;
	let picks = 0;
	await db.transaction('rw', db.settings, async () => {
		const cur = await readSettings();
		const at = new Date(now).toISOString();
		const next = (cur.pickInvites ?? []).flatMap((i) => {
			const f = found.get(i.id);
			if (!f) return [i];
			if (f.gone) return [];
			picks++;
			return [{ ...i, pickedIndex: f.pickedIndex, pickedAt: at }];
		});
		await db.settings.put({ ...cur, pickInvites: next });
	});
	return picks;
}

export interface PickedLine {
	id: string;
	personId: string;
	name: string;
	slot: Slot;
	label: string;
	text: string; // "Leo picked Sat 7 Nov, 10:00"
	calendarUrl: string;
	title: string;
}

/** Pure: Today's "picked" lines (newest link first), until closed or the time has passed. */
export function pickedLines(list: PickInvite[], now = Date.now()): PickedLine[] {
	return list
		.filter((i) => i.pickedIndex != null && !i.closed)
		.flatMap((i) => {
			const slot = i.slots[i.pickedIndex!];
			if (!slot || Date.parse(slot.end) < now) return [];
			const label = slot.label;
			return [{
				id: i.id,
				personId: i.personId,
				name: i.personName,
				slot,
				label,
				text: `${i.personName} picked ${label}`,
				calendarUrl: googleCalendarLink(slot, i.title),
				title: i.title
			}];
		});
}

/** Today's picked lines from storage. */
export async function picksToday(now = Date.now()): Promise<PickedLine[]> {
	return pickedLines((await readSettings()).pickInvites ?? [], now);
}

/** Closes a picked line on Today. */
export async function closePick(id: string): Promise<void> {
	const s = await readSettings();
	await updateSettings({ pickInvites: (s.pickInvites ?? []).map((i) => (i.id === id ? { ...i, closed: true } : i)) });
}

// ---- polling while the app is open and visible ----
let timer: ReturnType<typeof setInterval> | undefined;
let started = false;

function visible(): boolean {
	return typeof document === 'undefined' || document.visibilityState !== 'hidden';
}

async function tick(): Promise<void> {
	if (!visible()) return;
	await checkInvites().catch(() => 0);
	const s = await readSettings();
	// Nothing left to wait for: stop until the next shared link.
	if (!openInvites(s.pickInvites ?? []).length) stopTimer();
}

function stopTimer() {
	clearInterval(timer);
	timer = undefined;
}

function kick() {
	if (!started || timer) return;
	timer = setInterval(() => void tick(), PICK_POLL_MS);
}

/** Call once when the app opens. */
export function startPickPolling(): void {
	if (started || typeof window === 'undefined') return;
	started = true;
	void readSettings()
		.then((s) => {
			if (openInvites(s.pickInvites ?? []).length) {
				kick();
				return tick();
			}
		})
		.catch(() => {});
	const wake = () => {
		if (!visible()) return;
		void readSettings().then((s) => {
			if (openInvites(s.pickInvites ?? []).length) {
				kick();
				void tick();
			}
		});
	};
	if (typeof document !== 'undefined') document.addEventListener('visibilitychange', wake);
	window.addEventListener('online', wake);
}
