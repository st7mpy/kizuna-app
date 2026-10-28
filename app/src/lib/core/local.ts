// Small per-phone conveniences kept in localStorage: the guided first run, "was this useful?"
// answers, and hints already seen. Nothing here is needed for the app to work; every read and
// write survives a browser that blocks storage.

const PREFIX = 'kizuna:';
const KEYS = ['tour', 'useful', 'homeHint', 'persistAsked'] as const;
type Key = (typeof KEYS)[number];

export function readLocal<T>(key: Key, fallback: T): T {
	try {
		const raw = localStorage.getItem(PREFIX + key);
		return raw == null ? fallback : (JSON.parse(raw) as T);
	} catch {
		return fallback;
	}
}

export function writeLocal(key: Key, value: unknown): void {
	try {
		localStorage.setItem(PREFIX + key, JSON.stringify(value));
	} catch {
		/* storage blocked: the hint simply shows again */
	}
}

/** Clears every Kizuna convenience on this phone (Delete everything, /?fresh). */
export function clearLocal(): void {
	for (const k of KEYS) {
		try {
			localStorage.removeItem(PREFIX + k);
		} catch {
			/* nothing stored */
		}
	}
}

// ---------- "Was this useful?" ----------

export type UsefulAnswer = 'yes' | 'not_really';
export interface UsefulEntry {
	at: string; // ISO
	answer: UsefulAnswer;
	what: 'line' | 'group' | 'gift';
}

export function usefulAnswers(): UsefulEntry[] {
	const list = readLocal<UsefulEntry[]>('useful', []);
	return Array.isArray(list) ? list : [];
}

export function recordUseful(answer: UsefulAnswer, what: UsefulEntry['what'] = 'line', now = new Date()): void {
	writeLocal('useful', [...usefulAnswers(), { at: now.toISOString(), answer, what }].slice(-200));
}

/** Pure: the line a tester can choose to share ("Kizuna was useful 4 of 5 times (28 Oct to 31 Oct)."). */
export function usefulSummary(list: UsefulEntry[]): string {
	if (!list.length) return '';
	const yes = list.filter((x) => x.answer === 'yes').length;
	const day = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
	const from = day(list[0].at);
	const to = day(list[list.length - 1].at);
	return `Kizuna was useful ${yes} of ${list.length} times I sent a line (${from === to ? from : `${from} to ${to}`}).`;
}
