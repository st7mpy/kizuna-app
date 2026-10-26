import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GiftHint, Occasion } from '@kizuna/shared';
import { db } from '../db.ts';
import { draftGiftLine, giftCards, giftCardsFrom, giftTemplate, markGift, planWith, safeIdea } from './gifts.ts';
import { mkPerson, mkThread, mockRelay, resetDb, setOffline } from './testing.ts';

const papa = mkPerson({ id: 'papa', name: 'Papa', relation: 'parent', circle: 'in' });
const riya = mkPerson({ id: 'riya', name: 'Riya', relation: 'sibling', circle: 'in', phone: '919800000004' });
const mum = mkPerson({ id: 'mum', name: 'Mum', relation: 'parent', circle: 'in' });
const kabir = mkPerson({ id: 'kabir', name: 'Kabir', relation: 'friend', circle: 'in' });
const hint: GiftHint = { id: 'g1', personId: 'papa', what: 'a brighter reading lamp', fragmentId: 'f', createdAt: '2026-10-20T10:00:00Z', status: 'open' };
const bday = (day: string): Occasion => ({ day, name: "Papa's birthday", kind: 'birthday', personIds: ['papa'] });

describe('gift cards (pure)', () => {
	const cards = (day: string, occ: Occasion[] = [bday(day)]) => giftCardsFrom({ hints: [hint], people: [papa, riya, mum, kabir], occasions: occ, today: '2026-10-26' });
	it('shows 1 to 10 days before their occasion', () => {
		expect(cards('2026-10-26')).toEqual([]); // the day itself is too late
		expect(cards('2026-10-27')[0].daysLeft).toBe(1);
		expect(cards('2026-11-04')[0]).toMatchObject({ kind: 'gift', personId: 'papa', daysLeft: 9, withPersonId: 'riya', hint });
		expect(cards('2026-11-05')[0].daysLeft).toBe(10);
		expect(cards('2026-11-06')).toEqual([]);
	});
	it('needs an open hint, and someone else\'s birthday does not count', () => {
		expect(giftCardsFrom({ hints: [{ ...hint, status: 'done' }], people: [papa, riya], occasions: [bday('2026-11-04')], today: '2026-10-26' })).toEqual([]);
		expect(cards('', [{ day: '2026-11-04', name: "Mum's birthday", kind: 'birthday', personIds: ['mum'] }])).toEqual([]);
	});
	it('a gifting festival counts too', () => {
		const diwali: Occasion = { day: '2026-11-03', name: 'Diwali', kind: 'festival', personIds: [] };
		expect(cards('', [diwali])[0].occasion.name).toBe('Diwali');
		expect(cards('', [{ ...diwali, name: 'Karva Chauth' }])).toEqual([]);
	});
	it('plans with a sibling first, then family, never a friend or the person', () => {
		expect(planWith(papa, [papa, mum, riya, kabir])?.id).toBe('riya');
		expect(planWith(papa, [papa, mum, kabir])?.id).toBe('mum');
		expect(planWith(papa, [papa, kabir])).toBeNull();
	});
	it('keeps money and health out of the idea', () => {
		expect(safeIdea('a brighter reading lamp.')).toBe('a brighter reading lamp');
		expect(safeIdea('a lamp under Rs 2000')).toBeNull();
		expect(safeIdea('new knee brace')).toBeNull();
		expect(giftTemplate("Papa's birthday", 'a brighter reading lamp', 'mixed')).toBe("Papa's birthday aa raha hai. Idea: a brighter reading lamp. Saath mein plan karein?");
	});
});

beforeEach(async () => {
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(new Date(2026, 9, 26, 10, 0));
	setOffline(true);
	await resetDb();
	await db.people.bulkAdd([papa, riya, mum, kabir]);
	await db.gifts.add(hint);
	await db.occasions.add({ id: 'birthday:papa', ...bday('2026-11-04') });
	await db.threads.add(mkThread({ title: "Papa's 60th", personIds: ['papa', 'riya'] }));
});
afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

describe('gift cards', () => {
	it('come from the db and draft a line to Riya', async () => {
		const [card] = await giftCards();
		expect(card).toMatchObject({ personId: 'papa', daysLeft: 9, withPersonId: 'riya' });
		const { line, link } = await draftGiftLine(card);
		expect(line).toMatch(/brighter reading lamp/);
		expect(link.startsWith('https://wa.me/919800000004?text=')).toBe(true);
	});
	it('uses a drafted line only if it is clean', async () => {
		const [card] = await giftCards();
		setOffline(false);
		mockRelay(() => ({ line: 'Papa ke birthday ke liye lamp? Saath mein dekhte hain', language: 'mixed' }));
		expect((await draftGiftLine(card)).line).toBe('Papa ke birthday ke liye lamp? Saath mein dekhte hain');
		mockRelay(() => ({ line: 'Lamp is Rs 1500 on amazon, split?', language: 'en' }));
		expect((await draftGiftLine(card)).line).not.toMatch(/Rs|amazon/);
	});
	it('done or dropped hides it', async () => {
		await markGift('g1', 'done');
		expect(await giftCards()).toEqual([]);
	});
});
