// Per-client limits: a token bucket for bursts plus a daily cap.
// State lives in the isolate's memory, so these are per isolate. The edge rate-limit
// bindings (edgeAllow) are shared by a location's isolates, and budget.ts holds the
// global daily ceiling on spend.

import { ledger } from './budget.ts';

export interface LimitOptions { capacity: number; refillPerMinute: number; daily: number }

interface Bucket { tokens: number; updated: number; day: string; count: number }

export class RateLimiter {
	private buckets = new Map<string, Bucket>();
	constructor(private opts: LimitOptions) {}

	take(key: string, now = Date.now()): boolean {
		const day = new Date(now).toISOString().slice(0, 10);
		let b = this.buckets.get(key);
		if (!b) {
			if (this.buckets.size > 20_000) this.buckets.clear();
			b = { tokens: this.opts.capacity, updated: now, day, count: 0 };
			this.buckets.set(key, b);
		}
		if (b.day !== day) {
			b.day = day;
			b.count = 0;
		}
		b.tokens = Math.min(this.opts.capacity, b.tokens + ((now - b.updated) / 60_000) * this.opts.refillPerMinute);
		b.updated = now;
		if (b.tokens < 1 || b.count >= this.opts.daily) return false;
		b.tokens -= 1;
		b.count += 1;
		return true;
	}

	reset(): void {
		this.buckets.clear();
	}
}

/**
 * Checks the device's limit and a looser per-IP limit (so a fresh device id
 * doesn't buy a fresh allowance).
 */
export class ClientLimiter {
	readonly device: RateLimiter;
	readonly ip: RateLimiter;
	constructor(opts: LimitOptions, ipFactor = 4) {
		this.device = new RateLimiter(opts);
		this.ip = new RateLimiter({
			capacity: opts.capacity * ipFactor,
			refillPerMinute: opts.refillPerMinute * ipFactor,
			daily: opts.daily * ipFactor
		});
	}

	allow(req: Request, now = Date.now()): boolean {
		const ip = clientIp(req);
		if (!this.ip.take(`ip:${ip}`, now)) return false;
		return this.device.take(`d:${ip}|${deviceOf(req)}`, now);
	}

	reset(): void {
		this.device.reset();
		this.ip.reset();
	}
}

export function clientIp(req: Request): string {
	return req.headers.get('cf-connecting-ip') || 'local';
}

/** The per-install id: a header, or ?device= where headers can't be sent (WebSocket, WAV upload). */
export function deviceOf(req: Request): string {
	const raw = req.headers.get('x-kizuna-device') || new URL(req.url).searchParams.get('device') || '';
	return raw.slice(0, 64).replace(/[^\w-]/g, '');
}

/**
 * Voice: a listening session may open the socket and, if that fails, upload the recording.
 * Both carry the same ?session= id; only the first use takes a token, and an id works twice at most.
 */
export class VoiceLimiter {
	private sessions = new Map<string, number>();
	constructor(readonly limiter: ClientLimiter) {}

	allow(req: Request, now = Date.now()): boolean {
		const session = (new URL(req.url).searchParams.get('session') || '').slice(0, 64).replace(/[^\w-]/g, '');
		const key = session ? `${clientIp(req)}|${deviceOf(req)}|${session}` : '';
		const used = key ? this.sessions.get(key) : undefined;
		if (used !== undefined) {
			if (used >= 2) return false;
			this.sessions.set(key, used + 1);
			return true;
		}
		if (!this.limiter.allow(req, now)) return false;
		if (key) {
			if (this.sessions.size > 20_000) this.sessions.clear();
			this.sessions.set(key, 1);
		}
		return true;
	}

	reset(): void {
		this.sessions.clear();
		this.limiter.reset();
	}
}

export const limits = {
	spark: new ClientLimiter({ capacity: 20, refillPerMinute: 10, daily: 400 }, 2),
	// Weave can cost about $0.50 a call: its own, much smaller bucket.
	// Per phone; the per-IP ceiling is loose because a venue or office shares one address.
	weave: new ClientLimiter({ capacity: 2, refillPerMinute: 0.1, daily: 10 }, 25),
	voice: new VoiceLimiter(new ClientLimiter({ capacity: 6, refillPerMinute: 3, daily: 120 })),
	// One new invite a minute per phone; each is a KV write.
	inviteCreate: new ClientLimiter({ capacity: 2, refillPerMinute: 1, daily: 20 }, 2),
	// Picks (API and the pick page's form). Pickers have no device id, so this is per IP.
	invite: new ClientLimiter({ capacity: 5, refillPerMinute: 2, daily: 30 }, 1),
	ical: new ClientLimiter({ capacity: 6, refillPerMinute: 2, daily: 100 }),
	// Circles: creating one is a KV write per phone, like an invite.
	circleCreate: new ClientLimiter({ capacity: 3, refillPerMinute: 1, daily: 20 }, 2),
	// Member writes, keyed per IP + circle (family-page writers have no device id).
	circleWrite: new RateLimiter({ capacity: 6, refillPerMinute: 2, daily: 80 }),
	// And per IP across circles, so one address can't fill many.
	circleWriteIp: new RateLimiter({ capacity: 40, refillPerMinute: 12, daily: 600 }), // a venue shares one IP
	// Reads: the app re-fetches every 60 s while the map is open.
	circleRead: new RateLimiter({ capacity: 30, refillPerMinute: 6, daily: 3000 })
};

export function resetAllLimits(): void {
	for (const l of Object.values(limits)) l.reset();
	ledger.reset();
}

/** The edge rate-limit binding, keyed by IP (plus `scope`, if given); allows when the binding is absent or fails. */
export async function edgeAllow(binding: RateLimit | undefined, req: Request, scope?: string): Promise<boolean> {
	if (!binding) return true;
	try {
		return (await binding.limit({ key: scope ? `${clientIp(req)}|${scope}` : clientIp(req) })).success;
	} catch {
		return true;
	}
}
