// Talks to the Kizuna relay (same origin by default). Only the fixed tasks in the contract.
import type { SparkResponse, TaskIO, TaskName } from '@kizuna/shared';
import { readSettings } from '../db.ts';

const DEVICE_KEY = 'kizuna.device';
let memoryDeviceId: string | null = null;

export type RelayErrorCode =
	| 'offline' // no network, or the relay could not be reached
	| 'timeout'
	| 'http'
	| 'bad_request' | 'rate_limited' | 'model_error' | 'invalid_output' | 'too_large';

export class RelayError extends Error {
	constructor(public code: RelayErrorCode, detail?: string) {
		super(detail ? `${code}: ${detail}` : code);
		this.name = 'RelayError';
	}
	/** True when trying again later (when back online) is the right move, without counting a try. */
	get isConnectivity(): boolean {
		return this.code === 'offline';
	}
	/** Not about this request: offline, slow, or the relay asked us to wait. Try later, uncounted. */
	get isTransient(): boolean {
		return this.code === 'offline' || this.code === 'timeout' || this.code === 'rate_limited';
	}
}

/** Per-install random id, sent so the relay can rate-limit per phone. */
export function deviceId(): string {
	try {
		let id = localStorage.getItem(DEVICE_KEY);
		if (!id) {
			id = crypto.randomUUID();
			localStorage.setItem(DEVICE_KEY, id);
		}
		return id;
	} catch {
		memoryDeviceId ??= crypto.randomUUID();
		return memoryDeviceId;
	}
}

export function clearDeviceId(): void {
	memoryDeviceId = null;
	try {
		localStorage.removeItem(DEVICE_KEY);
	} catch {
		/* nothing stored */
	}
}

export function isOnline(): boolean {
	return typeof navigator === 'undefined' || navigator.onLine !== false;
}

export const TASK_TIMEOUTS: Record<TaskName, number> = {
	extract: 25_000,
	weave: 120_000,
	// A usable line is already on screen; the model line only replaces it if it comes quickly.
	draft: 8_000,
	plan: 30_000,
	rank: 10_000,
	windows: 15_000,
	weekend: 45_000,
	// The phone's own brief is already on screen; Spark's replaces it when it comes.
	brief: 15_000
};

async function baseUrl(): Promise<string> {
	const s = await readSettings();
	return (s.relayUrl ?? '').replace(/\/+$/, '');
}

// The day's model allowance is used up: Kizuna "rests" until the relay says it can read again.
let restingUntil = 0;
const restingListeners = new Set<(resting: boolean) => void>();

export function markResting(seconds: number, now = Date.now()): void {
	restingUntil = now + Math.min(Math.max(seconds, 60), 86_400) * 1000;
	for (const f of restingListeners) f(true);
}

/** True while the relay's daily budget is spent (notes are kept and read later). */
export function isResting(now = Date.now()): boolean {
	return restingUntil > now;
}

/** Calls `f` when Kizuna starts resting. Returns the unsubscribe. */
export function onResting(f: (resting: boolean) => void): () => void {
	restingListeners.add(f);
	return () => restingListeners.delete(f);
}

/** JSON request to the relay with a timeout. Throws RelayError. */
export async function relayJson<T>(path: string, init: { method?: string; body?: unknown; timeoutMs?: number } = {}): Promise<T> {
	if (!isOnline()) throw new RelayError('offline');
	const url = (await baseUrl()) + path;
	const ctrl = new AbortController();
	// The timer covers the whole exchange, body included: a stalled body must not hang the caller.
	const timer = setTimeout(() => ctrl.abort(), init.timeoutMs ?? 20_000);
	let res: Response;
	let data: unknown = null;
	try {
		try {
			res = await fetch(url, {
				method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
				headers: { 'content-type': 'application/json', 'x-kizuna-device': deviceId() },
				body: init.body === undefined ? undefined : JSON.stringify(init.body),
				signal: ctrl.signal
			});
		} catch (e) {
			throw ctrl.signal.aborted ? new RelayError('timeout') : new RelayError('offline', String(e));
		}
		let raw: string;
		// Some bodies ignore the abort (a stalled stream): stop waiting when the timer fires anyway.
		const gaveUp = new Promise<never>((_, reject) => {
			if (ctrl.signal.aborted) reject(new RelayError('timeout'));
			ctrl.signal.addEventListener('abort', () => reject(new RelayError('timeout')), { once: true });
		});
		gaveUp.catch(() => {});
		try {
			raw = await Promise.race([res.text(), gaveUp]);
		} catch (e) {
			if (e instanceof RelayError) throw e;
			throw ctrl.signal.aborted ? new RelayError('timeout') : new RelayError('offline', String(e));
		}
		try {
			data = raw ? JSON.parse(raw) : null;
		} catch {
			/* not JSON */
		}
	} finally {
		clearTimeout(timer);
	}
	if (!res.ok) {
		const err = (data as { error?: string } | null)?.error;
		if (err === 'rate_limited' && (data as { detail?: string } | null)?.detail === 'daily_budget') {
			markResting(Number(res.headers.get('retry-after')) || 3600);
		}
		const known = ['bad_request', 'rate_limited', 'model_error', 'invalid_output', 'too_large'];
		throw new RelayError(err && known.includes(err) ? (err as RelayErrorCode) : 'http', `status ${res.status}`);
	}
	return data as T;
}

/** Runs one Spark task on the relay. */
export async function spark<T extends TaskName>(task: T, input: TaskIO[T]['input'], timeoutMs = TASK_TIMEOUTS[task]): Promise<TaskIO[T]['output']> {
	const r = await relayJson<SparkResponse<T>>('/api/spark', { body: { task, input }, timeoutMs });
	if (!r || typeof r !== 'object') throw new RelayError('http', 'empty response');
	if (!r.ok) throw new RelayError(r.error, r.detail);
	return r.output;
}
