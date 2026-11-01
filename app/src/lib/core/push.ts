// Reminders on this phone: "someone answered", "a time was picked", and Friday's weekend call.
// The server gets only where to send, the time zone, and which family page and pick-a-time links
// to watch. Never notes. On iPhone this works once Kizuna is on the Home Screen (iOS 16.4 and later).
import { readSettings } from '../db.ts';
import { SAMPLE_CIRCLE_ID } from './circle.ts';
import { relayJson } from './relay.ts';

export type ReminderSupport = 'ready' | 'install' | 'none';
export type ReminderState = 'on' | 'off' | 'blocked';

function standalone(): boolean {
	try {
		return (navigator as Navigator & { standalone?: boolean }).standalone === true || matchMedia('(display-mode: standalone)').matches;
	} catch {
		return false;
	}
}

/** Pure: what this browser can do. An iPhone tab has to be added to the Home Screen first. */
export function reminderSupport(env: { ios: boolean; standalone: boolean; push: boolean }): ReminderSupport {
	if (env.ios && !env.standalone) return 'install';
	return env.push ? 'ready' : 'none';
}

export function reminderSupportHere(): ReminderSupport {
	if (typeof navigator === 'undefined' || typeof window === 'undefined') return 'none';
	const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
	const push = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
	return reminderSupport({ ios, standalone: standalone(), push });
}

async function registration(): Promise<ServiceWorkerRegistration | null> {
	if (!('serviceWorker' in navigator)) return null;
	try {
		return await Promise.race([navigator.serviceWorker.ready, new Promise<null>((r) => setTimeout(() => r(null), 5000))]);
	} catch {
		return null;
	}
}

export async function reminderState(): Promise<ReminderState> {
	if (reminderSupportHere() !== 'ready') return 'off';
	if (Notification.permission === 'denied') return 'blocked';
	if (Notification.permission !== 'granted') return 'off';
	const reg = await registration();
	return (await reg?.pushManager.getSubscription()) ? 'on' : 'off';
}

function keyBytes(b64u: string): Uint8Array {
	const pad = b64u.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((b64u.length + 3) % 4);
	const bin = atob(pad);
	const out = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
	return out;
}

/** Pure: the body the server stores. */
export function subscriptionBody(
	sub: { endpoint: string; keys?: { p256dh?: string; auth?: string } },
	s: { circle?: { id: string; memberId: string }; pickInvites?: { id: string; expiresAt: string; pickedIndex?: number | null }[] },
	timeZone: string,
	now = Date.now()
) {
	const circle = s.circle && s.circle.id !== SAMPLE_CIRCLE_ID ? s.circle : undefined;
	return {
		endpoint: sub.endpoint,
		p256dh: sub.keys?.p256dh ?? '',
		auth: sub.keys?.auth ?? '',
		timeZone,
		...(circle ? { circleId: circle.id, memberId: circle.memberId } : {}),
		invites: (s.pickInvites ?? []).filter((i) => i.pickedIndex == null && Date.parse(i.expiresAt) > now).map((i) => i.id).slice(0, 10)
	};
}

async function send(sub: PushSubscription): Promise<void> {
	const json = sub.toJSON() as { endpoint: string; keys?: { p256dh?: string; auth?: string } };
	const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
	await relayJson('/api/push/sub', { body: subscriptionBody(json, await readSettings(), tz), timeoutMs: 10_000 });
}

/** Must run from a tap: iPhone only asks for permission on a user gesture. */
export async function turnOnReminders(): Promise<ReminderState> {
	if (reminderSupportHere() !== 'ready') return 'off';
	const permission = await Notification.requestPermission();
	if (permission === 'denied') return 'blocked';
	if (permission !== 'granted') return 'off';
	const reg = await registration();
	if (!reg) throw new Error('no service worker');
	const { key } = await relayJson<{ ok: true; key: string }>('/api/push/key', { method: 'GET', timeoutMs: 10_000 });
	const sub =
		(await reg.pushManager.getSubscription()) ??
		(await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) as BufferSource }));
	await send(sub);
	return 'on';
}

export async function turnOffReminders(): Promise<void> {
	const reg = await registration();
	const sub = await reg?.pushManager.getSubscription();
	if (!sub) return;
	await relayJson('/api/push/unsub', { body: { endpoint: sub.endpoint }, timeoutMs: 10_000 }).catch(() => {});
	await sub.unsubscribe().catch(() => false);
}

/** Quietly tells the server what to watch now (a new family page or pick-a-time link). No prompt. */
export async function renewReminders(): Promise<void> {
	if (reminderSupportHere() !== 'ready' || Notification.permission !== 'granted') return;
	const reg = await registration();
	const sub = await reg?.pushManager.getSubscription();
	if (sub) await send(sub).catch(() => {});
}
