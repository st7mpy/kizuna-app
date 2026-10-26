import { describe, expect, it } from 'vitest';
import { dayKey, dayLabel, greeting, groupThreads, minutes, noteDay, snippet } from './format';
import type { Thread } from '@kizuna/shared';

describe('greeting', () => {
	it('follows the time of day', () => {
		expect(greeting(8)).toBe('Good morning');
		expect(greeting(13, 'Aarav')).toBe('Good afternoon, Aarav');
		expect(greeting(20, '  ')).toBe('Good evening');
		expect(greeting(2)).toBe('Hello');
	});
});

describe('dayLabel', () => {
	const today = '2026-10-26'; // a Monday
	it('uses words for nearby days', () => {
		expect(dayLabel('2026-10-26', today)).toBe('Today');
		expect(dayLabel('2026-10-27', today)).toBe('Tomorrow');
		expect(dayLabel('2026-10-25', today)).toBe('Yesterday');
		expect(dayLabel('2026-10-29', today)).toBe('Thursday');
	});
	it('uses a short date further out, never a count', () => {
		const far = dayLabel('2026-11-07', today);
		expect(far).toMatch(/7 Nov/);
		expect(far).not.toMatch(/days/);
		expect(dayLabel('2026-10-10', today)).toMatch(/10 Oct/);
	});
	it('labels notes by their local day', () => {
		const d = new Date(2026, 9, 26, 9, 30);
		expect(noteDay(d.toISOString(), dayKey(d))).toBe('Today');
	});
});

describe('snippet', () => {
	it('keeps short text and trims long text at a word', () => {
		expect(snippet('  hello   there ')).toBe('hello there');
		const s = snippet('one two three four five six seven eight nine ten', 20);
		expect(s.endsWith('…')).toBe(true);
		expect(s.length).toBeLessThanOrEqual(21);
		expect(s).not.toMatch(/ …$/);
	});
});

describe('groupThreads', () => {
	const t = (id: string, kind: Thread['kind']): Thread => ({
		id, kind, title: id, personIds: [], fragmentIds: [], status: 'open', createdAt: '', updatedAt: ''
	});
	it('groups in a fixed order and drops empty groups', () => {
		const g = groupThreads([t('a', 'errand'), t('b', 'idea'), t('c', 'errand')]);
		expect(g.map((x) => x.label)).toEqual(['Ideas', 'Errands']);
		expect(g[1].items.map((x) => x.id)).toEqual(['a', 'c']);
	});
});

describe('minutes', () => {
	it('reads HH:MM', () => {
		expect(minutes('18:30')).toBe(1110);
		expect(minutes('00:05')).toBe(5);
	});
});
