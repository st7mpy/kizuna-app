import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Fragment, Slot } from '@kizuna/shared';
import { db } from '../db.ts';
import { buildContext, buildMyLines, draftPoke, likelyLanguage, templateLine, whatsappLink } from './poke.ts';
import { markReached } from './people.ts';
import { isoWithOffset } from './days.ts';
import { mkEvent, mkPerson, mockRelay, resetDb, setOffline } from './testing.ts';

const NOW = new Date(2026, 9, 26, 10, 0);
const frag = (p: Partial<Fragment> & { id: string; text: string }): Fragment => ({
	createdAt: NOW.toISOString(), source: 'voice', status: 'done', tries: 0, ...p
});
const slot: Slot = { start: isoWithOffset(new Date(2026, 9, 29, 18, 30)), end: isoWithOffset(new Date(2026, 9, 29, 19, 30)), label: 'Thu 29 Oct, 18:30 to 19:30' };

beforeEach(async () => {
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(NOW);
	setOffline(false);
	await resetDb();
});
afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

describe('pure helpers', () => {
	const mom = mkPerson({ id: 'mom', name: 'Mom', relation: 'parent', summary: 'Knee surgery next week' });

	it('keeps private details out of the context', () => {
		const ctx = buildContext(
			mom,
			[
				mkEvent({ what: 'knee surgery', kind: 'appointment', personIds: ['mom'], day: '2026-10-29', fragmentId: 's' }),
				mkEvent({ what: 'cousin wedding', kind: 'plan', personIds: ['mom'], day: '2026-10-31', fragmentId: 'ok' })
			],
			[frag({ id: 's', text: 'Mom knee', sensitive: true }), frag({ id: 'ok', text: 'wedding' })],
			'2026-10-26'
		);
		expect(ctx.join(' ')).not.toMatch(/knee|surgery/i);
		expect(ctx).toContain('cousin wedding (on Saturday)');
		expect(ctx).toContain('has a lot going on lately');
	});

	it('uses short snippets of non-private notes for tone', () => {
		const lines = buildMyLines([
			frag({ id: 'a', text: 'Jordan started his new job, should call him. Also groceries.' }),
			frag({ id: 'b', text: 'Dad and the loan thing', sensitive: false }),
			frag({ id: 'c', text: 'x'.repeat(200) })
		]);
		expect(lines).toContain('Jordan started his new job, should call him.');
		expect(lines.some((l) => /loan/.test(l))).toBe(false);
		expect(lines.every((l) => l.length <= 80)).toBe(true);
	});

	it('guesses the language from notes about them', () => {
		const p = mkPerson({ name: 'Jordan' });
		expect(likelyLanguage(p, [frag({ id: '1', text: '', language: 'mixed' }), frag({ id: '2', text: '', language: 'mixed' }), frag({ id: '3', text: '', language: 'en' })])).toBe('mixed');
		expect(likelyLanguage(p, [])).toBe('en');
		expect(likelyLanguage({ ...p, relation: 'parent' }, [])).toBe('en');
	});

	it('has gentle templates with no guilt', () => {
		const p = mkPerson({ name: 'Jordan' });
		expect(templateLine(p, 'en')).toBe('Hi Jordan, thinking of you. How are things?');
		expect(templateLine(p, 'en', slot)).toBe('Hi Jordan, thinking of you. Free for a chat Thursday evening?');
		// the fallback is plain English whatever the notes were in
		expect(templateLine(p, 'mixed', slot)).toBe(templateLine(p, 'en', slot));
		for (const l of [templateLine(p, 'en'), templateLine(p, 'hi')]) expect(l).not.toMatch(/!|sorry|been ages|forgot/i);
	});

	it('builds wa.me links with or without a phone', () => {
		expect(whatsappLink('Hi Jordan, how are you?', '+1 312 555-0101')).toBe('https://wa.me/13125550101?text=Hi%20Jordan%2C%20how%20are%20you%3F');
		expect(whatsappLink('a&b')).toBe('https://wa.me/?text=a%26b');
	});
});

describe('draftPoke', () => {
	beforeEach(async () => {
		await db.people.add(mkPerson({ id: 'mom', name: 'Mom', relation: 'parent' }));
		await db.fragments.bulkAdd([
			frag({ id: 's', text: 'Mom has a knee appointment Thursday', sensitive: true, language: 'mixed', personIds: ['mom'] }),
			frag({ id: 'n', text: 'Need to buy a gift', language: 'en' })
		]);
		await db.events.add(mkEvent({ what: 'knee appointment', kind: 'appointment', personIds: ['mom'], day: '2026-10-29', fragmentId: 's' }));
	});

	it('sends a safe draft input and returns the line', async () => {
		const relay = mockRelay((task, input) => {
			expect(task).toBe('draft');
			return { line: "Hi Mom, how are you doing? Call Thursday evening?", language: 'mixed' };
		});
		const draft = await draftPoke('mom', 'Knee appointment on Thursday.', slot);
		expect(draft).toEqual({ line: 'Hi Mom, how are you doing? Call Thursday evening?', fromModel: true });
		const input = relay.calls[0].body.input;
		expect(input).toMatchObject({ personName: 'Mom', relation: 'parent', language: 'mixed', withTime: slot.label });
		expect(JSON.stringify(input)).not.toMatch(/knee/i);
		expect(input.myRecentLines).toEqual(['Need to buy a gift']);
	});

	it('falls back to a template offline or on failure', async () => {
		setOffline(true);
		expect(await draftPoke('mom', 'thinking of her')).toEqual({ line: 'Hi Mom, thinking of you. How are things?', fromModel: false });
		setOffline(false);
		mockRelay(() => {
			throw new Error('down');
		});
		expect(await draftPoke('mom', 'x', slot)).toEqual({ line: 'Hi Mom, thinking of you. Free for a chat Thursday evening?', fromModel: false });
	});

	it('marks a person reached when the user sends', async () => {
		await markReached('mom');
		expect((await db.people.get('mom'))!.lastReachedAt).toBe(NOW.toISOString());
	});
});
