import { describe, expect, it } from 'vitest';
import { RateLimiter, deviceOf, edgeAllow, limits } from '../src/ratelimit.ts';

describe('RateLimiter', () => {
	it('refills over time', () => {
		const l = new RateLimiter({ capacity: 2, refillPerMinute: 1, daily: 100 });
		const t = Date.parse('2026-11-02T10:00:00Z');
		expect(l.take('k', t)).toBe(true);
		expect(l.take('k', t)).toBe(true);
		expect(l.take('k', t)).toBe(false);
		expect(l.take('k', t + 30_000)).toBe(false);
		expect(l.take('k', t + 61_000)).toBe(true);
	});

	it('enforces a daily cap that resets at UTC midnight', () => {
		const l = new RateLimiter({ capacity: 100, refillPerMinute: 100, daily: 3 });
		const t = Date.parse('2026-11-02T23:00:00Z');
		for (let i = 0; i < 3; i++) expect(l.take('k', t + i)).toBe(true);
		expect(l.take('k', t + 3_600_000 - 1)).toBe(false);
		expect(l.take('k', t + 3_600_000 + 1)).toBe(true);
	});
});

describe('weave limit at a shared venue IP', () => {
	it('lets ten phones on one IP each weave, and still limits each phone', () => {
		limits.weave.reset();
		const t = Date.parse('2026-11-02T10:00:00Z');
		const req = (device: string) => new Request('https://k.test/api/spark', { headers: { 'cf-connecting-ip': '1.2.3.4', 'x-kizuna-device': device } });
		for (let i = 0; i < 10; i++) expect(limits.weave.allow(req(`phone-${i}`), t)).toBe(true);
		expect(limits.weave.allow(req('phone-0'), t)).toBe(true); // capacity 2
		expect(limits.weave.allow(req('phone-0'), t)).toBe(false);
		limits.weave.reset();
	});

	it('keys the edge weave limit per device, not per IP', async () => {
		const keys: string[] = [];
		const binding = { limit: async ({ key }: { key: string }) => (keys.push(key), { success: true }) } as unknown as RateLimit;
		const req = new Request('https://k.test/api/spark', { headers: { 'cf-connecting-ip': '1.2.3.4', 'x-kizuna-device': 'abc' } });
		await edgeAllow(binding, req, deviceOf(req));
		expect(keys).toEqual(['1.2.3.4|abc']);
	});
});

describe('voice at a shared venue IP', () => {
	it('lets ten judges on one Wi-Fi each start several voice sessions, and still limits each phone', () => {
		limits.voice.reset();
		const t = Date.parse('2026-11-02T10:00:00Z');
		let n = 0;
		const req = (device: string) =>
			new Request(`wss://k.test/api/asr?device=${device}&session=s${n++}`, { headers: { 'cf-connecting-ip': '1.2.3.4' } });
		for (let i = 0; i < 10; i++) for (let j = 0; j < 4; j++) expect(limits.voice.allow(req(`judge-${i}`), t)).toBe(true);
		// Each phone still has its own burst of 6.
		expect(limits.voice.allow(req('judge-0'), t)).toBe(true);
		expect(limits.voice.allow(req('judge-0'), t)).toBe(true);
		expect(limits.voice.allow(req('judge-0'), t)).toBe(false);
	});
});
