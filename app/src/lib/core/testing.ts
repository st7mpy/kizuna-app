// Test helpers (only imported by *.test.ts files).
import type { KEvent, Person, Prompt, Thread } from '@kizuna/shared';
import { vi } from 'vitest';
import { db } from '../db.ts';

export async function resetDb(): Promise<void> {
	await Promise.all(db.tables.map((t) => t.clear()));
}

export type SparkHandler = (task: string, input: any) => unknown;

/** Stubs fetch: /api/spark goes to `spark`, other paths to `other`. Records calls. */
export function mockRelay(spark: SparkHandler, other: (path: string, body: any) => unknown = () => ({ ok: true })) {
	const calls: { path: string; body: any; headers: Record<string, string> }[] = [];
	const fn = vi.fn(async (url: string, init?: RequestInit) => {
		const path = String(url).replace(/^https?:\/\/[^/]+/, '');
		const body = init?.body ? JSON.parse(String(init.body)) : undefined;
		calls.push({ path, body, headers: (init?.headers ?? {}) as Record<string, string> });
		try {
			const data = path === '/api/spark' ? { ok: true, output: await spark(body.task, body.input) } : await other(path, body);
			return new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } });
		} catch (e) {
			if (e instanceof TypeError) throw e; // simulated network failure
			return new Response(JSON.stringify({ ok: false, error: 'model_error' }), { status: 502 });
		}
	});
	vi.stubGlobal('fetch', fn);
	return { fn, calls, tasks: () => calls.filter((c) => c.path === '/api/spark').map((c) => c.body.task as string) };
}

export function setOffline(off: boolean) {
	vi.stubGlobal('navigator', { onLine: !off });
}

let n = 0;
const iso = (d: Date) => d.toISOString();

export function mkPerson(p: Partial<Person> & { name: string }): Person {
	return { id: p.id ?? `p${++n}`, aliases: [p.name.toLowerCase()], relation: 'friend', circle: 'none', mentions: 1, createdAt: iso(new Date(2026, 0, 1)), ...p };
}
export function mkEvent(e: Partial<KEvent> & { what: string; personIds: string[] }): KEvent {
	return { id: e.id ?? `e${++n}`, kind: 'other', day: null, time: null, dateText: null, dateConfidence: 'sure', fragmentId: 'f0', createdAt: iso(new Date(2026, 0, 1)), ...e };
}
export function mkThread(t: Partial<Thread> & { title: string }): Thread {
	return { id: t.id ?? `t${++n}`, kind: 'idea', personIds: [], fragmentIds: [], status: 'open', dueDay: null, createdAt: iso(new Date(2026, 0, 1)), updatedAt: iso(new Date(2026, 0, 1)), ...t };
}
export function mkPrompt(p: Partial<Prompt> & { shownAt: string }): Prompt {
	return { id: p.id ?? `pr${++n}`, personId: null, threadId: null, reason: 'gap', reasonText: '', ...p };
}
