import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CircleEntry, Sealed, Settings } from '@kizuna/shared';
import { newCircleKey, openEntry, sealEntry } from '@kizuna/shared';
import { db, defaultSettings } from '../db.ts';
import {
	autoLink,
	buildMyEntry,
	circleLink,
	createCircle,
	freeWindows,
	leaveCircle,
	linkMember,
	newCircleLink,
	pickShareWindows,
	forgetPublished,
	publishMyEntry,
	refreshCircle,
	setSharing
} from './circle.ts';
import { getSettings, updateSettings } from './settings.ts';
import { inviteFamilyLine, invitePersonLine } from './invite.ts';
import { answerLines, dismissAnswer } from './answers.ts';
import { mkPerson, resetDb, setOffline } from './testing.ts';
import { addDays, localDay, setHomeZone } from './days.ts';

const TZ = 'Asia/Kolkata';
const NOW = new Date('2026-10-26T04:30:00Z'); // Mon 10:00 in Delhi

/** A tiny in-memory relay: one sealed entry per member. */
function fakeRelay() {
	const store = new Map<string, Map<string, Sealed>>();
	const calls: { method: string; path: string }[] = [];
	let n = 0;
	vi.stubGlobal(
		'fetch',
		vi.fn(async (url: string, init?: RequestInit) => {
			const path = String(url).replace(/^https?:\/\/[^/]+/, '');
			const method = init?.method ?? 'GET';
			calls.push({ method, path });
			const json = (d: unknown, status = 200) => new Response(JSON.stringify(d), { status });
			if (method === 'POST' && path === '/api/circle') {
				const id = `circle${String(++n).padStart(10, '0')}`;
				store.set(id, new Map());
				return json({ ok: true, id, url: `/c/${id}` });
			}
			const m = /^\/api\/circle\/([^/]+)(?:\/m\/([^/]+))?$/.exec(path);
			const c = m && store.get(m[1]);
			if (!m || !c) return json({ ok: false, error: 'not_found' }, 404);
			if (method === 'PUT') c.set(m[2], JSON.parse(String(init!.body)));
			if (method === 'DELETE') c.delete(m[2]);
			if (method === 'GET') return json({ ok: true, id: m[1], members: [...c].map(([memberId, s]) => ({ memberId, ...s })) });
			return json({ ok: true });
		})
	);
	return { store, calls };
}

const entry = (p: Partial<CircleEntry>): CircleEntry => ({
	v: 1, name: 'Riya', tz: TZ, status: null, statusUntil: null, windows: [], via: 'page', updatedAt: NOW.toISOString(), ...p
});

beforeEach(async () => {
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(NOW);
	setOffline(false);
	await resetDb();
	forgetPublished();
	await updateSettings({ myName: 'Aarav Mehta', relayUrl: 'https://kizuna.test' });
});
afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

describe('windows', () => {
	it('free hours minus busy times, at least 45 minutes', () => {
		const ws = freeWindows({
			freeHours: [{ day: 6, start: '10:00', end: '13:00' }],
			busy: [{ start: '2026-10-31T11:00:00+05:30', end: '2026-10-31T12:30:00+05:30' }],
			nowMs: NOW.getTime(),
			timeZone: TZ,
			fromDay: '2026-10-26',
			toDay: '2026-11-01'
		});
		// 10:00-11:00 stays; 12:30-13:00 is too short
		expect(ws).toEqual([{ start: '2026-10-31T10:00:00+05:30', end: '2026-10-31T11:00:00+05:30' }]);
	});

	it('shares at most 3, weekend first', () => {
		const ws = freeWindows({
			freeHours: defaultSettings().freeHours,
			busy: [],
			nowMs: NOW.getTime(),
			timeZone: TZ,
			fromDay: '2026-10-26',
			toDay: '2026-11-01'
		});
		const picked = pickShareWindows(ws, TZ);
		expect(picked).toHaveLength(3);
		expect(picked.every((w) => /2026-10-3[01]|2026-11-01/.test(w.start))).toBe(true);
		expect(picked[0].start).toBe('2026-10-30T18:30:00+05:30'); // Friday evening counts as weekend
	});
});

describe('my entry', () => {
	const base = (p: Partial<NonNullable<Settings['circle']>> = {}, room?: Settings['room']): Settings => ({
		...defaultSettings(),
		myName: 'Aarav Mehta',
		room,
		circle: { id: 'c', key: 'k', memberId: 'me', share: true, freeToday: false, paused: false, ...p }
	});

	it('shares first name, zone, quiet hours and windows; never the room level', () => {
		const e = buildMyEntry(base({}, { day: localDay(NOW), level: 'lots' }), NOW, [], TZ);
		expect(e).toMatchObject({ v: 1, name: 'Aarav', tz: TZ, status: null, statusUntil: null, quietStart: '21:30', via: 'app' });
		expect(e.windows.length).toBeGreaterThan(0);
		expect(JSON.stringify(e)).not.toMatch(/lots|room/);
	});

	it('free today comes from the room tap only when turned on, and lasts at most 12 h', () => {
		const tap = (level: 'low' | 'some' | 'lots') => buildMyEntry(base({ freeToday: true }, { day: localDay(NOW), level }), NOW, [], TZ);
		expect(tap('lots').status).toBe('free');
		expect(tap('some').status).toBe('maybe');
		expect(tap('low').status).toBeNull();
		const until = Date.parse(tap('lots').statusUntil!);
		expect(until).toBeLessThanOrEqual(NOW.getTime() + 12 * 3600_000);
		expect(until).toBeGreaterThan(NOW.getTime());
		// a tap from yesterday is not today's
		expect(buildMyEntry(base({ freeToday: true }, { day: addDays(localDay(NOW), -1), level: 'lots' }), NOW, [], TZ).status).toBeNull();
	});

	it('not sharing writes nothing useful', () => {
		const e = buildMyEntry(base({ share: false, freeToday: true }, { day: localDay(NOW), level: 'lots' }), NOW, [], TZ);
		expect(e.windows).toEqual([]);
		expect(e.status).toBeNull();
	});
});

describe('the circle', () => {
	it('creates, publishes a sealed entry and builds the family link', async () => {
		const relay = fakeRelay();
		const c = await createCircle();
		expect(c).toMatchObject({ share: true, freeToday: false, paused: false });
		expect(c.memberId).toMatch(/^[A-Za-z0-9_-]{12}$/);
		const sealed = relay.store.get(c.id)!.get(c.memberId)!;
		expect(JSON.stringify(sealed)).not.toMatch(/Aarav/);
		const mine = await openEntry(c.key, c.id, c.memberId, sealed);
		expect(mine?.name).toBe('Aarav');
		expect(await circleLink()).toBe(`https://kizuna.test/c/${c.id}#k=${c.key}&from=Aarav`);
	});

	it('refresh opens entries, skips mine, links people by name and keeps a manual link', async () => {
		const relay = fakeRelay();
		await db.people.bulkAdd([
			mkPerson({ id: 'riya', name: 'Riya', relation: 'sibling', circle: 'in' }),
			mkPerson({ id: 'mum', name: 'Mum', relation: 'parent', aliases: ['mum', 'mummy'], circle: 'in' })
		]);
		const c = await createCircle();
		const put = async (memberId: string, e: CircleEntry) => relay.store.get(c.id)!.set(memberId, await sealEntry(c.key, c.id, memberId, e));
		await put('riyaMember01', entry({ name: 'Riya' }));
		await put('mummyMember1', entry({ name: 'Mummy' }));
		await put('strangerMem1', entry({ name: 'Someone' }));
		relay.store.get(c.id)!.set('badEntry0001', { iv: 'AAAAAAAAAAAAAAAA', ct: 'AAAA' });
		await refreshCircle();
		const rows = await db.members.toArray();
		expect(rows.map((r) => [r.entry.name, r.personId]).sort()).toEqual([['Mummy', 'mum'], ['Riya', 'riya'], ['Someone', null]]);
		await linkMember('strangerMem1', 'riya');
		await refreshCircle();
		expect((await db.members.get('strangerMem1'))!.personId).toBe('riya');
		expect((await getSettings()).circle!.lastSyncAt).toBe(NOW.toISOString());
	});

	it('refresh stores answeredAt for a new or changed family-page answer, and Today says so', async () => {
		const relay = fakeRelay();
		await db.people.add(mkPerson({ id: 'mum', name: 'Mum', relation: 'parent', aliases: ['mum'], circle: 'in' }));
		const c = await createCircle();
		const put = async (memberId: string, e: CircleEntry) => relay.store.get(c.id)!.set(memberId, await sealEntry(c.key, c.id, memberId, e));
		const sunday = [{ start: '2026-11-01T14:00:00+05:30', end: '2026-11-01T17:00:00+05:30' }];
		const answered = new Date(NOW.getTime() - 3600_000).toISOString();
		await put('mumMember001', entry({ name: 'Mum', windows: sunday, updatedAt: answered }));
		await put('appMember001', entry({ name: 'Riya', via: 'app', windows: sunday }));
		await refreshCircle();
		setHomeZone(TZ); // read the answer in Delhi time
		const mum = (await db.members.get('mumMember001'))!;
		expect(mum.answeredAt).toBe(answered);
		expect(mum.answerSeen).toBe(false);
		expect((await db.members.get('appMember001'))!.answeredAt).toBeUndefined(); // the app shares on its own; not an answer
		expect((await answerLines()).map((l) => l.text)).toEqual(['Mum answered: Sunday afternoon']);

		// Closed: stays closed while nothing changes.
		await dismissAnswer('mumMember001');
		await refreshCircle();
		expect(await answerLines()).toEqual([]);
		expect((await db.members.get('mumMember001'))!.answeredAt).toBe(answered);

		// A changed answer comes back, with its own time (never later than now).
		vi.setSystemTime(new Date(NOW.getTime() + 600_000));
		await put('mumMember001', entry({ name: 'Mum', windows: [], notThisWeekend: true, updatedAt: new Date(NOW.getTime() + 3600_000).toISOString() }));
		await refreshCircle();
		const again = (await db.members.get('mumMember001'))!;
		expect(again.answeredAt).toBe(new Date(NOW.getTime() + 600_000).toISOString());
		expect((await answerLines()).map((l) => l.text)).toEqual(['Mum answered: not this weekend']);
		setHomeZone(null);
	});

	it('the group invite names the family; a person invite carries their name for the page', async () => {
		fakeRelay();
		await db.people.bulkAdd([
			mkPerson({ id: 'mum', name: 'Mum', relation: 'parent', circle: 'in', phone: '919800000002' }),
			mkPerson({ id: 'kabir', name: 'Kabir', relation: 'friend', circle: 'in' }),
			mkPerson({ id: 'nani', name: 'Nani', relation: 'family', circle: 'suggested' })
		]);
		const group = await inviteFamilyLine();
		expect(group.invitees).toEqual(['mum']);
		expect(group.line).toMatch(/#k=[A-Za-z0-9_-]{43}&from=Aarav$/);
		const one = await invitePersonLine('mum');
		const c = (await getSettings()).circle!;
		expect(one.line).toBe(`Hi Mum, family call this weekend? Tap the times that work for you, no app needed: https://kizuna.test/c/${c.id}#k=${c.key}&from=Aarav&for=Mum`);
		expect(one.link.startsWith('https://wa.me/919800000002?text=')).toBe(true);
		expect(one.phone).toBe('919800000002');
		// the same circle, not a new one
		expect(group.line).toContain(`/c/${c.id}#`);
	});

	it('pause deletes my entry; leave deletes it and forgets the circle', async () => {
		const relay = fakeRelay();
		const c = await createCircle();
		await setSharing({ paused: true });
		expect(relay.store.get(c.id)!.has(c.memberId)).toBe(false);
		await setSharing({ paused: false });
		expect(relay.store.get(c.id)!.has(c.memberId)).toBe(true);
		await db.members.put({ memberId: 'x', personId: null, entry: entry({}), fetchedAt: '' });
		await leaveCircle();
		expect(relay.store.get(c.id)!.has(c.memberId)).toBe(false);
		expect((await getSettings()).circle).toBeUndefined();
		expect(await db.members.count()).toBe(0);
	});

	it('a new link makes a new circle and drops the old members', async () => {
		fakeRelay();
		const a = await createCircle();
		await db.members.put({ memberId: 'x', personId: null, entry: entry({}), fetchedAt: '' });
		const link = await newCircleLink();
		const b = (await getSettings()).circle!;
		expect(b.id).not.toBe(a.id);
		expect(b.key).not.toBe(a.key);
		expect(link).toContain(b.id);
		expect(await db.members.count()).toBe(0);
	});

	it('the sample circle never touches the network', async () => {
		const relay = fakeRelay();
		await updateSettings({ circle: { id: 'sample', key: '', memberId: 'sample-me000', share: true, freeToday: true, paused: false } });
		await db.members.put({ memberId: 'sample-00001', personId: null, entry: entry({}), fetchedAt: '' });
		await refreshCircle();
		await publishMyEntry();
		expect(relay.calls).toEqual([]);
		expect(await circleLink()).toBeNull();
		// asking the family makes a real circle, and sample members stay
		const { line, link } = await inviteFamilyLine();
		expect(line).toMatch(/https:\/\/kizuna\.test\/c\/circle\d+#k=/);
		expect(link.startsWith('https://wa.me/?text=')).toBe(true);
		await refreshCircle();
		expect(await db.members.get('sample-00001')).toBeTruthy();
	});

	it('re-saves my entry only when it changed, at most once per 30 s', async () => {
		vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
		vi.setSystemTime(NOW);
		const relay = fakeRelay();
		await createCircle(); // one PUT, forced
		const puts = () => relay.calls.filter((c) => c.method === 'PUT').length;
		expect(puts()).toBe(1);
		// Same content: app opens, refreshes, minutes pass: no writes.
		await publishMyEntry();
		vi.setSystemTime(NOW.getTime() + 5 * 60_000);
		await publishMyEntry();
		expect(puts()).toBe(1);
		// A change is written; a second change inside 30 s waits for the gap, then goes once.
		await updateSettings({ quietStart: '21:00' });
		await publishMyEntry();
		expect(puts()).toBe(2);
		await updateSettings({ quietStart: '21:30' });
		await publishMyEntry();
		await publishMyEntry();
		expect(puts()).toBe(2);
		await vi.advanceTimersByTimeAsync(31_000);
		await vi.waitFor(() => expect(puts()).toBe(3));
		// An unchanged entry is refreshed after 6 hours.
		vi.setSystemTime(Date.now() + 6 * 3600_000 + 1);
		await publishMyEntry();
		expect(puts()).toBe(4);
	});

	it('offline does nothing and does not throw', async () => {
		const relay = fakeRelay();
		await updateSettings({ circle: { id: 'circle0000000001', key: newCircleKey(), memberId: 'me0000000001', share: true, freeToday: false, paused: false } });
		setOffline(true);
		await publishMyEntry();
		await refreshCircle();
		expect(relay.calls).toEqual([]);
	});
});

describe('auto link', () => {
	it('matches by alias among circle people only', () => {
		const people = [
			mkPerson({ id: 'mum', name: 'Mum', relation: 'parent', aliases: ['mum', 'ma'], circle: 'in' }),
			mkPerson({ id: 'dev', name: 'Dev', circle: 'none' })
		];
		expect(autoLink(people, 'Ma')).toBe('mum');
		expect(autoLink(people, 'Dev')).toBeNull();
	});
});
