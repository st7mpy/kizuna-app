// The global daily ceiling on the paid key (and on KV writes), shared by every isolate.
//
// Each isolate keeps its own running totals for the UTC day and writes them, now and then,
// into the metadata of its own KV key (budget:<day>:<isolate>), so isolates never overwrite
// each other. Readers sum all keys for the day with one list call. KV is eventually consistent
// (about a minute), so the ceiling can be overshot a little; the per-IP limits cover that gap.
import type { Env } from './env.ts';
import { fail } from './http.ts';
import type { Usage } from './model.ts';

// Prices: Spark $1.25 / 1M input tokens, $4.25 / 1M output tokens; voice $0.18 per audio hour.
export function sparkUsd(u: Usage): number {
	return (u.input_tokens * 1.25 + u.output_tokens * 4.25) / 1e6;
}
export function audioUsd(ms: number): number {
	return (Math.max(0, ms) / 3_600_000) * 0.18;
}

export interface Tally { usd: number; weave: number; writes: number }
const zero = (): Tally => ({ usd: 0, weave: 0, writes: 0 });
const plus = (a: Tally, b: Partial<Tally>): Tally => ({ usd: a.usd + (b.usd ?? 0), weave: a.weave + (b.weave ?? 0), writes: a.writes + (b.writes ?? 0) });
const utcDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** How often to re-read other isolates' totals, and when to write ours (by time or by amount). */
const READ_MS = 3 * 60_000;
const FLUSH_MS = 10 * 60_000;
const FLUSH_USD = 0.1;
const FLUSH_WRITES = 20;

export class Ledger {
	private id = crypto.randomUUID().slice(0, 12);
	private day = '';
	private mine = zero();
	private saved = zero();
	private savedAt = 0;
	private others = zero();
	private readAt = -Infinity;

	private key(): string {
		return `budget:${this.day}:${this.id}`;
	}

	private roll(now: number): void {
		const d = utcDay(now);
		if (d === this.day) return;
		this.day = d;
		this.mine = zero();
		this.saved = zero();
		this.others = zero();
		this.savedAt = now;
		this.readAt = -Infinity;
	}

	/** Today's totals across isolates (others' as last read, ours live). */
	async totals(kv: KVNamespace, now = Date.now()): Promise<Tally> {
		this.roll(now);
		if (now - this.readAt >= READ_MS) {
			this.readAt = now;
			try {
				let sum = zero();
				let cursor: string | undefined;
				for (let page = 0; page < 5; page++) {
					const r = await kv.list<Tally>({ prefix: `budget:${this.day}:`, cursor });
					for (const k of r.keys) if (k.name !== this.key() && k.metadata) sum = plus(sum, k.metadata);
					if (r.list_complete) break;
					cursor = r.cursor;
				}
				this.others = sum;
			} catch {
				/* keep the last known totals */
			}
		}
		return plus(this.others, this.mine);
	}

	/** Adds to our totals; writes them to KV when enough has changed. */
	async add(kv: KVNamespace, part: Partial<Tally>, now = Date.now()): Promise<void> {
		this.roll(now);
		this.mine = plus(this.mine, part);
		const due =
			this.mine.usd - this.saved.usd >= FLUSH_USD ||
			this.mine.writes - this.saved.writes >= FLUSH_WRITES ||
			(now - this.savedAt >= FLUSH_MS && (this.mine.usd > this.saved.usd || this.mine.writes > this.saved.writes));
		if (!due) return;
		this.savedAt = now;
		this.mine.writes += 1; // this write counts too
		const snapshot = { ...this.mine };
		try {
			await kv.put(this.key(), '', { metadata: snapshot, expirationTtl: 2 * 86_400 });
			this.saved = snapshot;
		} catch {
			/* try again next time */
		}
	}

	reset(): void {
		this.day = '';
		this.roll(Date.now());
	}
}

export const ledger = new Ledger();

function num(v: string | undefined, d: number): number {
	const n = Number(v);
	return v != null && v !== '' && Number.isFinite(n) && n >= 0 ? n : d;
}

export function caps(env: Env): { usd: number; weave: number; writes: number } {
	const usd = num(env.DAILY_BUDGET_USD, 5);
	return { usd, weave: num(env.WEAVE_BUDGET_USD, usd * 0.4), writes: num(env.KV_WRITES_PER_DAY, 600) };
}

/** False once today's spend (or weave's own share) has reached its cap. */
export async function withinBudget(env: Env, weave = false, now = Date.now()): Promise<boolean> {
	const t = await ledger.totals(env.INVITES, now);
	const c = caps(env);
	return t.usd < c.usd && (!weave || t.weave < c.weave);
}

export async function spend(env: Env, usd: number, weave = false, now = Date.now()): Promise<void> {
	if (usd > 0) await ledger.add(env.INVITES, { usd, weave: weave ? usd : 0 }, now);
}

/** KV writes (invites, picks) stay under a daily cap so the account's write limit can't be used up. */
export async function canWrite(env: Env, now = Date.now()): Promise<boolean> {
	return (await ledger.totals(env.INVITES, now)).writes < caps(env).writes;
}

export async function wrote(env: Env, now = Date.now()): Promise<void> {
	await ledger.add(env.INVITES, { writes: 1 }, now);
}

/** "Come back tomorrow": a 429 that lasts until UTC midnight. */
export function overBudget(now = Date.now()): Response {
	const midnight = Date.parse(utcDay(now) + 'T00:00:00Z') + 86_400_000;
	return fail('rate_limited', 'daily_budget', Math.ceil((midnight - now) / 1000));
}
