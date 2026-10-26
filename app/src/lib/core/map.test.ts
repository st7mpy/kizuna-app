import { describe, expect, it } from 'vitest';
import type { CircleEntry, Settings } from '@kizuna/shared';
import { defaultSettings, type MemberRow } from '../db.ts';
import { glowOf, mapView, type MapInputs } from './map.ts';
import { mkPerson } from './testing.ts';
import { daylightAt } from './zones.ts';

// 12:30 UTC = 18:00 in Delhi, 08:30 in Toronto (EDT), 13:30 in London (BST)
const NOW = new Date('2026-10-23T12:30:00Z');

const entry = (p: Partial<CircleEntry>): CircleEntry => ({
	v: 1, name: 'X', tz: 'Asia/Kolkata', status: null, statusUntil: null, windows: [], via: 'app', updatedAt: NOW.toISOString(), ...p
});
const row = (memberId: string, personId: string | null, e: Partial<CircleEntry>): MemberRow => ({ memberId, personId, entry: entry(e), fetchedAt: NOW.toISOString() });

const sharing: Settings = { ...defaultSettings(), myName: 'Aarav', circle: { id: 'c', key: 'k', memberId: 'm', share: true, freeToday: true, paused: false } };

function inputs(p: Partial<MapInputs> = {}): MapInputs {
	return {
		now: NOW,
		settings: sharing,
		people: [
			mkPerson({ id: 'mum', name: 'Mum', relation: 'parent', circle: 'in', mentions: 9 }),
			mkPerson({ id: 'kabir', name: 'Kabir', relation: 'friend', circle: 'in', mentions: 20 }),
			mkPerson({ id: 'riya', name: 'Riya', relation: 'sibling', circle: 'in' }),
			mkPerson({ id: 'ishaan', name: 'Ishaan', circle: 'suggested' })
		],
		members: [
			row('m-mum', 'mum', { tz: 'Asia/Kolkata', status: 'free', statusUntil: new Date(NOW.getTime() + 3600_000).toISOString() }),
			row('m-kabir', 'kabir', { tz: 'America/Toronto', status: 'maybe', statusUntil: new Date(NOW.getTime() + 3600_000).toISOString() })
		],
		personal: [{ day: '2026-10-30', name: "Mum's birthday", kind: 'birthday', personIds: ['mum'] }],
		giftPersonIds: new Set(['mum']),
		notePersonIds: new Set(['kabir']),
		timeZone: 'Europe/London',
		...p
	};
}

describe('map view', () => {
	it('puts family inside, friends outside, circle people only', () => {
		const v = mapView(inputs());
		expect(v.people.map((p) => `${p.ring}:${p.person.name}`)).toEqual(['inner:Mum', 'inner:Riya', 'outer:Kabir']);
		expect(v.me).toEqual({ name: 'Aarav', tz: 'Europe/London', localTime: '13:30' });
		expect(v.sharing).toBe(true);
	});

	it('shows local time and daylight at their end; unknown zone is null', () => {
		const v = mapView(inputs());
		const by = (id: string) => v.people.find((p) => p.person.id === id)!;
		expect(by('mum')).toMatchObject({ tz: 'Asia/Kolkata', localTime: '18:00', memberId: 'm-mum' });
		expect(by('kabir')).toMatchObject({ tz: 'America/Toronto', localTime: '08:30' });
		expect(by('riya')).toMatchObject({ tz: null, localTime: null, daylight: 0, memberId: null, glow: null });
		expect(by('kabir').daylight).toBeGreaterThan(0);
		expect(by('mum').daylight).toBeLessThan(by('kabir').daylight);
	});

	it('glows only while I share (reciprocity)', () => {
		expect(mapView(inputs()).people.map((p) => p.glow)).toEqual(['open', null, 'maybe']);
		for (const circle of [undefined, { ...sharing.circle!, share: false }, { ...sharing.circle!, paused: true }]) {
			const v = mapView(inputs({ settings: { ...sharing, circle } }));
			expect(v.sharing).toBe(false);
			expect(v.people.every((p) => p.glow === null)).toBe(true);
		}
	});

	it('marks occasions, gifts and notes; at most 8 people', () => {
		const v = mapView(inputs());
		const mum = v.people[0];
		expect(mum.occasion?.name).toBe("Mum's birthday");
		expect(mum.hasGift).toBe(true);
		expect(v.people[2].hasNotes).toBe(true);
		const many = Array.from({ length: 12 }, (_, i) => mkPerson({ id: `f${i}`, name: `F${i}`, circle: 'in' }));
		expect(mapView(inputs({ people: many })).people).toHaveLength(8);
	});
});

describe('glow expiry', () => {
	const now = NOW.getTime();
	it('ends at statusUntil', () => {
		expect(glowOf(row('a', 'x', { status: 'free', statusUntil: new Date(now - 1).toISOString() }), now)).toBeNull();
		expect(glowOf(row('a', 'x', { status: 'free', statusUntil: new Date(now + 60_000).toISOString() }), now)).toBe('open');
		expect(glowOf(row('a', 'x', { status: 'maybe', statusUntil: null }), now)).toBeNull();
		expect(glowOf(undefined, now)).toBeNull();
	});
	it('never lasts more than 12 hours from when it was written', () => {
		const written = new Date(now - 13 * 3600_000).toISOString();
		expect(glowOf(row('a', 'x', { status: 'free', updatedAt: written, statusUntil: new Date(now + 3600_000).toISOString() }), now)).toBeNull();
	});
});

describe('daylight', () => {
	it('is dark at night and brightest around midday', () => {
		expect(daylightAt(2 * 60)).toBe(0);
		expect(daylightAt(23 * 60)).toBe(0);
		expect(daylightAt(12 * 60 + 30)).toBeGreaterThan(0.95);
		expect(daylightAt(8 * 60)).toBeLessThan(daylightAt(11 * 60));
	});
});
