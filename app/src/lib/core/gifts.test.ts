import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GiftHint, Occasion } from '@kizuna/shared';
import { db } from '../db.ts';
import { draftGiftLine, giftCards, giftCardsFrom, giftHintsInText, giftTemplate, markGift, planWith, safeIdea } from './gifts.ts';
import { mkPerson, mkThread, mockRelay, resetDb, setOffline } from './testing.ts';

const dad = mkPerson({ id: 'dad', name: 'Dad', relation: 'parent', circle: 'in' });
const maya = mkPerson({ id: 'maya', name: 'Maya', relation: 'sibling', circle: 'in', phone: '13125550104' });
const mom = mkPerson({ id: 'mom', name: 'Mom', relation: 'parent', circle: 'in' });
const jordan = mkPerson({ id: 'jordan', name: 'Jordan', relation: 'friend', circle: 'in' });
const hint: GiftHint = { id: 'g1', personId: 'dad', what: 'new running shoes', fragmentId: 'f', createdAt: '2026-10-20T10:00:00Z', status: 'open' };
const bday = (day: string): Occasion => ({ day, name: "Dad's birthday", kind: 'birthday', personIds: ['dad'] });

describe('gift cards (pure)', () => {
	const cards = (day: string, occ: Occasion[] = [bday(day)]) => giftCardsFrom({ hints: [hint], people: [dad, maya, mom, jordan], occasions: occ, today: '2026-10-26' });
	it('shows 1 to 10 days before their occasion', () => {
		expect(cards('2026-10-26')).toEqual([]); // the day itself is too late
		expect(cards('2026-10-27')[0].daysLeft).toBe(1);
		expect(cards('2026-11-04')[0]).toMatchObject({ kind: 'gift', personId: 'dad', daysLeft: 9, withPersonId: 'maya', hint });
		expect(cards('2026-11-05')[0].daysLeft).toBe(10);
		expect(cards('2026-11-06')).toEqual([]);
	});
	it('needs an open hint, and someone else\'s birthday does not count', () => {
		expect(giftCardsFrom({ hints: [{ ...hint, status: 'done' }], people: [dad, maya], occasions: [bday('2026-11-04')], today: '2026-10-26' })).toEqual([]);
		expect(cards('', [{ day: '2026-11-04', name: "Mom's birthday", kind: 'birthday', personIds: ['mom'] }])).toEqual([]);
	});
	it('a gifting festival counts too', () => {
		const xmas: Occasion = { day: '2026-11-03', name: 'Christmas', kind: 'festival', personIds: [] };
		expect(cards('', [xmas])[0].occasion.name).toBe('Christmas');
		expect(cards('', [{ ...xmas, name: 'Thanksgiving' }])).toEqual([]);
	});
	it('plans with a sibling first, then family, never a friend or the person', () => {
		expect(planWith(dad, [dad, mom, maya, jordan])?.id).toBe('maya');
		expect(planWith(dad, [dad, mom, jordan])?.id).toBe('mom');
		expect(planWith(dad, [dad, jordan])).toBeNull();
	});
	it('keeps money and health out of the idea', () => {
		expect(safeIdea('new running shoes.')).toBe('new running shoes');
		expect(safeIdea('shoes under $200')).toBeNull();
		expect(safeIdea('new knee brace')).toBeNull();
		expect(giftTemplate("Dad's birthday", 'new running shoes', 'mixed')).toBe("Dad's birthday is coming up. I was thinking new running shoes. Plan it together?");
	});
});

beforeEach(async () => {
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(new Date(2026, 9, 26, 10, 0));
	setOffline(true);
	await resetDb();
	await db.people.bulkAdd([dad, maya, mom, jordan]);
	await db.gifts.add(hint);
	await db.occasions.add({ id: 'birthday:dad', ...bday('2026-11-04') });
	await db.threads.add(mkThread({ title: "Dad's 60th", personIds: ['dad', 'maya'] }));
});
afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

describe('gift cards', () => {
	it('come from the db and draft a line to Maya', async () => {
		const [card] = await giftCards();
		expect(card).toMatchObject({ personId: 'dad', daysLeft: 9, withPersonId: 'maya' });
		const { line, link } = await draftGiftLine(card);
		expect(line).toMatch(/running shoes/);
		expect(link.startsWith('https://wa.me/13125550104?text=')).toBe(true);
	});
	it('uses a drafted line only if it is clean', async () => {
		const [card] = await giftCards();
		setOffline(false);
		mockRelay(() => ({ line: 'Shoes for Dad? Want to go halves on the plan?', language: 'en' }));
		expect((await draftGiftLine(card)).line).toBe('Shoes for Dad? Want to go halves on the plan?');
		mockRelay(() => ({ line: 'Shoes are $150 on amazon, split?', language: 'en' }));
		expect((await draftGiftLine(card)).line).not.toMatch(/\$|amazon/);
	});
	it('done or dropped hides it', async () => {
		await markGift('g1', 'done');
		expect(await giftCards()).toEqual([]);
	});
});

describe('gift hints the model missed', () => {
	it('finds "Dad wants new running shoes" among several clauses', () => {
		const note = "Mom's birthday is next Friday, should call Leo before his exams, Dad wants new running shoes";
		expect(giftHintsInText(note, ['Mom', 'Leo', 'Dad'])).toEqual([{ person: 'Dad', what: 'new running shoes' }]);
	});
	it('reads "would love" and "needs a new", and skips plans, help, money and health', () => {
		expect(giftHintsInText('Maya needs a new desk lamp and Mom would love a bread maker.', ['Maya', 'Mom'])).toEqual([
			{ person: 'Maya', what: 'new desk lamp' },
			{ person: 'Mom', what: 'bread maker' }
		]);
		expect(giftHintsInText('Jordan wants to meet up. Dad needs help with the move.', ['Jordan', 'Dad'])).toEqual([]);
		expect(giftHintsInText('Dad wants a $300 watch', ['Dad'])).toEqual([]);
		expect(giftHintsInText('Mom needs new knee medicine', ['Mom'])).toEqual([]);
		expect(giftHintsInText('Grandad wants a kite', ['Dad'])).toEqual([]);
	});
});
