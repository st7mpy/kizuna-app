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
	const mum = mkPerson({ id: 'mum', name: 'Mum', relation: 'parent', summary: 'Knee surgery next week' });

	it('keeps private details out of the context', () => {
		const ctx = buildContext(
			mum,
			[
				mkEvent({ what: 'knee surgery', kind: 'appointment', personIds: ['mum'], day: '2026-10-29', fragmentId: 's' }),
				mkEvent({ what: 'cousin wedding', kind: 'plan', personIds: ['mum'], day: '2026-10-31', fragmentId: 'ok' })
			],
			[frag({ id: 's', text: 'Mum knee', sensitive: true }), frag({ id: 'ok', text: 'wedding' })],
			'2026-10-26'
		);
		expect(ctx.join(' ')).not.toMatch(/knee|surgery/i);
		expect(ctx).toContain('cousin wedding (on Saturday)');
		expect(ctx).toContain('has a lot going on lately');
	});

	it('uses short snippets of non-private notes for tone', () => {
		const lines = buildMyLines([
			frag({ id: 'a', text: 'Kabir ne naya job join kiya, should call him. Also groceries.' }),
			frag({ id: 'b', text: 'Papa ka loan wala issue', sensitive: false }),
			frag({ id: 'c', text: 'x'.repeat(200) })
		]);
		expect(lines).toContain('Kabir ne naya job join kiya, should call him.');
		expect(lines.some((l) => /loan/.test(l))).toBe(false);
		expect(lines.every((l) => l.length <= 80)).toBe(true);
	});

	it('guesses the language from notes about them', () => {
		const p = mkPerson({ name: 'Kabir' });
		expect(likelyLanguage(p, [frag({ id: '1', text: '', language: 'mixed' }), frag({ id: '2', text: '', language: 'mixed' }), frag({ id: '3', text: '', language: 'en' })])).toBe('mixed');
		expect(likelyLanguage(p, [])).toBe('en');
		expect(likelyLanguage({ ...p, relation: 'parent' }, [])).toBe('mixed');
	});

	it('has gentle templates with no guilt', () => {
		const p = mkPerson({ name: 'Kabir' });
		expect(templateLine(p, 'en')).toBe('Hi Kabir, thinking of you. How are things?');
		expect(templateLine(p, 'en', slot)).toBe('Hi Kabir, thinking of you. Free for a chat Thursday evening?');
		expect(templateLine(p, 'mixed', slot)).toMatch(/^Hi Kabir, kaise ho\?.*Thursday evening baat karein\?$/);
		for (const l of [templateLine(p, 'en'), templateLine(p, 'hi')]) expect(l).not.toMatch(/!|sorry|been ages|forgot/i);
	});

	it('builds wa.me links with or without a phone', () => {
		expect(whatsappLink('Hi Kabir, kaise ho?', '+91 98000-00001')).toBe('https://wa.me/919800000001?text=Hi%20Kabir%2C%20kaise%20ho%3F');
		expect(whatsappLink('a&b')).toBe('https://wa.me/?text=a%26b');
	});
});

describe('draftPoke', () => {
	beforeEach(async () => {
		await db.people.add(mkPerson({ id: 'mum', name: 'Mum', relation: 'parent' }));
		await db.fragments.bulkAdd([
			frag({ id: 's', text: 'Mum ka knee appointment Thursday hai', sensitive: true, language: 'mixed', personIds: ['mum'] }),
			frag({ id: 'n', text: 'Need to buy a gift', language: 'en' })
		]);
		await db.events.add(mkEvent({ what: 'knee appointment', kind: 'appointment', personIds: ['mum'], day: '2026-10-29', fragmentId: 's' }));
	});

	it('sends a safe draft input and returns the line', async () => {
		const relay = mockRelay((task, input) => {
			expect(task).toBe('draft');
			return { line: "Hi Mum, how are you doing? Call Thursday evening?", language: 'mixed' };
		});
		const line = await draftPoke('mum', 'Knee appointment on Thursday.', slot);
		expect(line).toBe('Hi Mum, how are you doing? Call Thursday evening?');
		const input = relay.calls[0].body.input;
		expect(input).toMatchObject({ personName: 'Mum', relation: 'parent', language: 'mixed', withTime: slot.label });
		expect(JSON.stringify(input)).not.toMatch(/knee/i);
		expect(input.myRecentLines).toEqual(['Need to buy a gift']);
	});

	it('falls back to a template offline or on failure', async () => {
		setOffline(true);
		expect(await draftPoke('mum', 'thinking of her')).toBe('Hi Mum, kaise ho? Bas yaad aa gayi.');
		setOffline(false);
		mockRelay(() => {
			throw new Error('down');
		});
		expect(await draftPoke('mum', 'x', slot)).toMatch(/Thursday evening baat karein\?$/);
	});

	it('marks a person reached when the user sends', async () => {
		await markReached('mum');
		expect((await db.people.get('mum'))!.lastReachedAt).toBe(NOW.toISOString());
	});
});
