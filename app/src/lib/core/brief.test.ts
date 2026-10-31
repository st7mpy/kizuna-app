import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Fragment } from '@kizuna/shared';
import { db } from '../db.ts';
import { briefFor, briefInput, clearBriefCache, cleanBrief, localBrief, type Brief } from './brief.ts';
import { sameTitle, similar } from './text.ts';
import { mkEvent, mkPerson, mockRelay, resetDb, setOffline } from './testing.ts';

const NOW = new Date(2026, 9, 26, 10, 0);
const frag = (p: Partial<Fragment> & { id: string; text: string }): Fragment => ({
	createdAt: NOW.toISOString(), source: 'voice', status: 'done', tries: 0, ...p
});

beforeEach(async () => {
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(NOW);
	setOffline(false);
	clearBriefCache();
	await resetDb();
});
afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

describe('brief helpers', () => {
	const leo = mkPerson({ id: 'leo', name: 'Leo', relation: 'child' });

	it('keeps private, money and old notes out of the input', () => {
		const input = briefInput(
			leo,
			['exams next week (on Monday)'],
			[
				frag({ id: 'a', text: 'Leo has exams next week' }),
				frag({ id: 'b', text: 'Leo knee hurts again' }),
				frag({ id: 'c', text: 'Leo wants the $200 headphones' }),
				frag({ id: 'd', text: 'Leo private thing', sensitive: true }),
				frag({ id: 'e', text: 'Leo joined the band', createdAt: new Date(2026, 7, 1).toISOString() })
			],
			'2026-10-26'
		);
		expect(input.notes).toEqual([{ day: '2026-10-26', text: 'Leo has exams next week' }]);
	});

	it('prefers notes that name them, and keeps the first sentence', () => {
		const dad = mkPerson({ id: 'dad', name: 'Dad', aliases: ['papa'], relation: 'parent' });
		const input = briefInput(dad, [], [frag({ id: 'a', text: 'Leo sent a photo from the library.' }), frag({ id: 'b', text: 'Papa started golf. He loves it.' })], '2026-10-26');
		expect(input.notes.map((n) => n.text)).toEqual(['Papa started golf. He loves it.']);
		expect(localBrief(input).lines).toEqual(['Papa started golf.']);
	});

	it('builds a phone brief with a gentle ask, and nothing when there is nothing', () => {
		const b = localBrief({ personName: 'Mom', relation: 'parent', today: '2026-10-26', context: ['has something personal going on (on Thursday); ask how they are, do not mention details', 'cousin wedding (on Saturday)'], notes: [] });
		expect(b).toEqual({ lines: ['Cousin wedding (on Saturday)'], ask: 'How have you been?', fromModel: false });
		expect(localBrief({ personName: 'X', relation: 'friend', today: '2026-10-26', context: [], notes: [] }).lines).toEqual([]);
	});

	it('leaves out lines that repeat each other', () => {
		expect(similar("Dad's 60th birthday (on 9 Nov)", 'Family dinner for Dad’s 60th')).toBe(true);
		expect(similar('Birthday dinner for Dad (on 9 Nov)', "Dad's 60th birthday")).toBe(true);
		expect(similar('Starts new job in LA', 'Grandma likes Sunday afternoons')).toBe(false);
		expect(sameTitle('Call Leo before exams', 'Call Leo before his exams')).toBe(true);
		expect(sameTitle('Call Leo', 'Call Leo about Thanksgiving')).toBe(false);
		const b = localBrief({ personName: 'Dad', relation: 'parent', today: '2026-10-26', context: ["Dad's 60th birthday (on 9 Nov)", 'Birthday dinner for Dad (on 9 Nov)'], notes: [{ day: '2026-10-25', text: 'Dad started golf lessons' }] });
		expect(b.lines).toEqual(["Dad's 60th birthday (on 9 Nov)", 'Dad started golf lessons']);
	});

	it('drops unsafe or empty model output', () => {
		expect(cleanBrief({ lines: ['Her surgery is Thursday'], ask: '' })).toBeNull();
		expect(cleanBrief(null)).toBeNull();
		expect(cleanBrief({ lines: ['Exams start Monday', 'x'.repeat(200)], ask: 'Nervous about Monday?' })).toMatchObject({ ask: 'Nervous about Monday?', fromModel: true });
		expect(cleanBrief({ lines: ['x'.repeat(200)], ask: '' })!.lines[0].length).toBe(90);
	});
});

describe('briefFor', () => {
	beforeEach(async () => {
		await db.people.add(mkPerson({ id: 'leo', name: 'Leo', relation: 'child' }));
		await db.fragments.add(frag({ id: 'a', text: 'Leo has exams next week', personIds: ['leo'] }));
		await db.events.add(mkEvent({ what: 'exams', kind: 'plan', personIds: ['leo'], day: '2026-11-02', fragmentId: 'a' }));
	});

	it('shows the phone brief first, then Spark, and caches it', async () => {
		const relay = mockRelay((task, input) => {
			expect(task).toBe('brief');
			expect(input.notes).toEqual([{ day: '2026-10-26', text: 'Leo has exams next week' }]);
			return { lines: ['Exams start Monday'], ask: 'Feeling ready for Monday?' };
		});
		const seen: (Brief | null)[] = [];
		await briefFor('leo', (b) => seen.push(b));
		expect(seen.map((b) => b?.fromModel)).toEqual([false, true]);
		expect(seen[1]!.lines).toEqual(['Exams start Monday']);
		const again: (Brief | null)[] = [];
		await briefFor('leo', (b) => again.push(b));
		expect(again).toEqual([seen[1]]);
		expect(relay.tasks()).toEqual(['brief']);
	});

	it('keeps the phone brief offline or when Spark fails', async () => {
		setOffline(true);
		const seen: (Brief | null)[] = [];
		await briefFor('leo', (b) => seen.push(b));
		expect(seen).toHaveLength(1);
		expect(seen[0]!.fromModel).toBe(false);
		setOffline(false);
		mockRelay(() => {
			throw new Error('down');
		});
		const more: (Brief | null)[] = [];
		await briefFor('leo', (b) => more.push(b));
		expect(more).toHaveLength(1);
	});

	it('says nothing for an unknown person', async () => {
		const seen: (Brief | null)[] = [];
		await briefFor('nobody', (b) => seen.push(b));
		expect(seen).toEqual([null]);
	});
});
