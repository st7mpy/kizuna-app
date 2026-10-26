// Per-client limits: a token bucket for bursts plus a daily cap.
// State lives in the isolate's memory, so limits are per edge location and reset
// when the isolate is recycled. Good enough to stop casual abuse of the model key.

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
		const ip = req.headers.get('cf-connecting-ip') || 'local';
		const device = (req.headers.get('x-kizuna-device') || '').slice(0, 64).replace(/[^\w-]/g, '');
		if (!this.ip.take(`ip:${ip}`, now)) return false;
		return this.device.take(`d:${ip}|${device}`, now);
	}

	reset(): void {
		this.device.reset();
		this.ip.reset();
	}
}

export const limits = {
	spark: new ClientLimiter({ capacity: 20, refillPerMinute: 10, daily: 400 }),
	voice: new ClientLimiter({ capacity: 6, refillPerMinute: 3, daily: 120 }),
	invite: new ClientLimiter({ capacity: 10, refillPerMinute: 2, daily: 60 }),
	ical: new ClientLimiter({ capacity: 6, refillPerMinute: 2, daily: 100 })
};

export function resetAllLimits(): void {
	for (const l of Object.values(limits)) l.reset();
}
