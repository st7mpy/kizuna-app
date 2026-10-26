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
	draft: 15_000,
	plan: 30_000,
	rank: 10_000
};

async function baseUrl(): Promise<string> {
	const s = await readSettings();
	return (s.relayUrl ?? '').replace(/\/+$/, '');
}

/** JSON request to the relay with a timeout. Throws RelayError. */
export async function relayJson<T>(path: string, init: { method?: string; body?: unknown; timeoutMs?: number } = {}): Promise<T> {
	if (!isOnline()) throw new RelayError('offline');
	const url = (await baseUrl()) + path;
	const ctrl = new AbortController();
	const timer = setTimeout(() => ctrl.abort(), init.timeoutMs ?? 20_000);
	let res: Response;
	try {
		res = await fetch(url, {
			method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
			headers: { 'content-type': 'application/json', 'x-kizuna-device': deviceId() },
			body: init.body === undefined ? undefined : JSON.stringify(init.body),
			signal: ctrl.signal
		});
	} catch (e) {
		throw ctrl.signal.aborted ? new RelayError('timeout') : new RelayError('offline', String(e));
	} finally {
		clearTimeout(timer);
	}
	let data: unknown = null;
	try {
		data = await res.json();
	} catch {
		/* not JSON */
	}
	if (!res.ok) {
		const err = (data as { error?: string } | null)?.error;
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
