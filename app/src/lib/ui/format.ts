// Small text helpers for the screens. Plain words, never counters.
import type { Thread, ThreadKind } from '@kizuna/shared';

const pad = (n: number) => String(n).padStart(2, '0');

/** 'YYYY-MM-DD' in local time. */
export function dayKey(d: Date = new Date()): string {
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function parseDay(day: string): Date {
	const [y, m, d] = day.split('-').map(Number);
	return new Date(y, m - 1, d);
}

export function greeting(hour: number, name?: string): string {
	const part = hour < 5 ? 'Hello' : hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
	return name?.trim() ? `${part}, ${name.trim()}` : part;
}

/** A future or near day in words: "today", "tomorrow", "Thursday", or "Sat 9 Nov". */
export function dayLabel(day: string, today: string = dayKey()): string {
	const diff = Math.round((parseDay(day).getTime() - parseDay(today).getTime()) / 86400000);
	if (diff === 0) return 'Today';
	if (diff === 1) return 'Tomorrow';
	if (diff === -1) return 'Yesterday';
	const d = parseDay(day);
	if (diff > 1 && diff < 7) return d.toLocaleDateString('en-GB', { weekday: 'long' });
	return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

/** When a note was written, as a calm label (no "N days ago"). */
export function noteDay(iso: string, today: string = dayKey()): string {
	return dayLabel(dayKey(new Date(iso)), today);
}

/** First letter up, for titles that come back lower-case. */
export function cap(s: string): string {
	return s ? s[0].toUpperCase() + s.slice(1) : s;
}

export function snippet(text: string, max = 140): string {
	const t = text.replace(/\s+/g, ' ').trim();
	if (t.length <= max) return t;
	const cut = t.slice(0, max);
	const sp = cut.lastIndexOf(' ');
	return (sp > max * 0.6 ? cut.slice(0, sp) : cut).replace(/[,.;:\s]+$/, '') + '…';
}

export const KIND_ORDER: ThreadKind[] = ['idea', 'plan', 'promise', 'errand'];
export const KIND_LABEL: Record<ThreadKind, string> = {
	idea: 'Ideas',
	plan: 'Plans',
	promise: 'Promises',
	errand: 'Errands'
};

export function groupThreads(threads: Thread[]): { kind: ThreadKind; label: string; items: Thread[] }[] {
	return KIND_ORDER.map((kind) => ({
		kind,
		label: KIND_LABEL[kind],
		items: threads.filter((t) => t.kind === kind)
	})).filter((g) => g.items.length > 0);
}

/** Splits a typed time window like "18:30" into minutes, for sorting and checks. */
export function minutes(hhmm: string): number {
	const [h, m] = hhmm.split(':').map(Number);
	return h * 60 + (m || 0);
}

export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
/** Monday first, the way most people think of a week. */
export const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];
