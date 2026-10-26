// POST /api/ical: fetch a private calendar link and return busy times only.
// Nothing is stored; event titles never leave this function.
import ICAL from 'ical.js';
import { fail, json, readBody, readCapped } from './http.ts';
import { limits } from './ratelimit.ts';

export const MAX_ICS_BYTES = 2 * 1024 * 1024;
const TIMEOUT_MS = 8_000;
const MAX_RANGE_MS = 62 * 86_400_000;
const MAX_BUSY = 1000;

export type Busy = { start: string; end: string };

function isPrivateV4(host: string): boolean {
	const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
	if (!m) return false;
	const [a, b] = [Number(m[1]), Number(m[2])];
	return (
		a === 0 || a === 10 || a === 127 || a >= 224 ||
		(a === 100 && b >= 64 && b <= 127) ||
		(a === 169 && b === 254) ||
		(a === 172 && b >= 16 && b <= 31) ||
		(a === 192 && b === 168) ||
		(a === 198 && (b === 18 || b === 19))
	);
}

/** Normalises a calendar link, or returns null if it is not a safe public https URL. */
export function safeCalendarUrl(input: unknown): URL | null {
	if (typeof input !== 'string' || input.length > 2048) return null;
	let s = input.trim();
	if (/^webcals?:\/\//i.test(s)) s = s.replace(/^webcals?:\/\//i, 'https://');
	let u: URL;
	try {
		u = new URL(s);
	} catch {
		return null;
	}
	if (u.protocol !== 'https:' || u.username || u.password) return null;
	if (u.port && u.port !== '443') return null;
	const host = u.hostname.toLowerCase().replace(/\.$/, '');
	if (!host.includes('.')) return null;
	if (host.startsWith('[') || host.includes(':')) return null; // IPv6 literals
	if (/(^|\.)(localhost|local|internal|intranet|lan|home|corp|localdomain)$/.test(host)) return null;
	if (/^\d+$/.test(host) || /^0x/i.test(host)) return null; // numeric host forms
	if (isPrivateV4(host)) return null;
	return u;
}

async function fetchCalendar(url: URL): Promise<string | 'too_large' | null> {
	let current = url;
	for (let hop = 0; hop < 4; hop++) {
		const res = await fetch(current.toString(), {
			redirect: 'manual',
			headers: { accept: 'text/calendar, text/plain;q=0.8, */*;q=0.1', 'user-agent': 'Kizuna calendar reader' },
			signal: AbortSignal.timeout(TIMEOUT_MS)
		});
		if (res.status >= 300 && res.status < 400) {
			await res.body?.cancel().catch(() => {});
			const next = safeCalendarUrl(new URL(res.headers.get('location') ?? '', current).toString());
			if (!next) return null;
			current = next;
			continue;
		}
		if (!res.ok) {
			await res.body?.cancel().catch(() => {});
			return null;
		}
		const len = Number(res.headers.get('content-length') ?? NaN);
		if (Number.isFinite(len) && len > MAX_ICS_BYTES) return 'too_large';
		const bytes = await readCapped(res.body, MAX_ICS_BYTES);
		if (!bytes) return 'too_large';
		return new TextDecoder().decode(bytes);
	}
	return null;
}

function opaque(c: any): boolean {
	const status = String(c.getFirstPropertyValue('status') ?? '').toUpperCase();
	if (status === 'CANCELLED') return false;
	const transp = String(c.getFirstPropertyValue('transp') ?? '').toUpperCase();
	return transp !== 'TRANSPARENT';
}

/** Busy intervals (UTC ISO, merged, sorted) from an .ics text within [fromMs, toMs). */
export function busyFromIcs(text: string, fromMs: number, toMs: number): Busy[] {
	const root = new ICAL.Component(ICAL.parse(text));
	const cals = root.name === 'vcalendar' ? [root] : root.getAllSubcomponents('vcalendar');
	const raw: [number, number][] = [];

	const add = (start: any, end: any, comp: any) => {
		if (!opaque(comp)) return;
		// All-day items are usually birthdays and holidays; count them only if marked busy.
		if (start.isDate && String(comp.getFirstPropertyValue('transp') ?? '').toUpperCase() !== 'OPAQUE') return;
		const s = start.toJSDate().getTime();
		const e = end ? end.toJSDate().getTime() : s + (start.isDate ? 86_400_000 : 0);
		if (!(e > s) || e <= fromMs || s >= toMs) return;
		raw.push([Math.max(s, fromMs), Math.min(e, toMs)]);
	};

	const collect = (cal: any) => {
		for (const tz of cal.getAllSubcomponents('vtimezone')) {
			try {
				ICAL.TimezoneService.register(tz);
			} catch {
				/* skip a broken zone */
			}
		}
		const events = cal.getAllSubcomponents('vevent').map((v: any) => new ICAL.Event(v));
		const exceptions = events.filter((e: any) => e.isRecurrenceException());
		const byUid = new Map<string, any>();
		for (const e of events) if (!e.isRecurrenceException()) byUid.set(e.uid, e);
		for (const ex of exceptions) {
			const master = byUid.get(ex.uid);
			if (master) master.relateException(ex);
			else add(ex.startDate, ex.endDate, ex.component);
		}
		for (const ev of byUid.values()) {
			if (!ev.startDate) continue;
			if (!ev.isRecurring()) {
				add(ev.startDate, ev.endDate, ev.component);
				continue;
			}
			const it = ev.iterator();
			for (let i = 0, next = it.next(); next && i < 5000; i++, next = it.next()) {
				if (next.toJSDate().getTime() >= toMs) break;
				const d = ev.getOccurrenceDetails(next);
				add(d.startDate, d.endDate, d.item.component);
			}
		}
	};

	// Zones go into ical.js's global registry; clear it after so it never grows across requests.
	try {
		for (const cal of cals) collect(cal);
	} finally {
		ICAL.TimezoneService.reset();
	}

	raw.sort((a, b) => a[0] - b[0]);
	const merged: [number, number][] = [];
	for (const [s, e] of raw) {
		const last = merged[merged.length - 1];
		if (last && s <= last[1]) last[1] = Math.max(last[1], e);
		else merged.push([s, e]);
	}
	return merged.slice(0, MAX_BUSY).map(([s, e]) => ({ start: new Date(s).toISOString(), end: new Date(e).toISOString() }));
}

export async function handleIcal(req: Request): Promise<Response> {
	if (!limits.ical.allow(req)) return fail('rate_limited');
	const bytes = await readBody(req, 4096);
	if (!bytes) return fail('too_large');
	let body: any;
	try {
		body = JSON.parse(new TextDecoder().decode(bytes));
	} catch {
		return fail('bad_request');
	}
	const url = safeCalendarUrl(body?.url);
	if (!url) return fail('bad_request', 'use a public https calendar link');
	const fromMs = Date.parse(body?.from);
	let toMs = Date.parse(body?.to);
	if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || toMs <= fromMs) return fail('bad_request', 'from/to');
	toMs = Math.min(toMs, fromMs + MAX_RANGE_MS);

	let text: string | 'too_large' | null;
	try {
		text = await fetchCalendar(url);
	} catch {
		text = null;
	}
	if (text === 'too_large') return fail('too_large');
	if (text == null) return fail('fetch_failed');
	try {
		return json({ ok: true, busy: busyFromIcs(text, fromMs, toMs) });
	} catch {
		return fail('parse_failed');
	}
}
