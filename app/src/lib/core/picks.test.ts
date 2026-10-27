import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db, defaultSettings } from '../db.ts';
import { checkInvites, closePick, openInvites, pickedLines, picksToday, recordInvite } from './picks.ts';
import { createInvite } from './time.ts';
import { mkPerson, mockRelay, resetDb, setOffline } from './testing.ts';

const NOW = new Date('2026-11-02T09:00:00Z');
const sat = { start: '2026-11-07T04:30:00Z', end: '2026-11-07T05:30:00Z', label: 'Sat 7 Nov, 10:00' };
const sun = { start: '2026-11-08T04:30:00Z', end: '2026-11-08T05:30:00Z', label: 'Sun 8 Nov, 10:00' };

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

describe('pick-a-time picks on Today', () => {
	it('remembers a link shared with a suggested person who is not saved yet', async () => {
		await db.settings.put(defaultSettings());
		mockRelay(
			() => null,
			(path) => {
				if (path === '/api/invite') return { ok: true, id: 'inv9', url: '/p/inv9' };
				throw new Error('unexpected ' + path);
			}
		);
		vi.stubGlobal('location', { origin: 'https://kizuna.example' });
		await createInvite('suggested-leo', [sat, sun], 'Leo');
		const s = await db.settings.get('me');
		expect(s!.pickInvites).toHaveLength(1);
		expect(s!.pickInvites![0]).toMatchObject({ id: 'inv9', personName: 'Leo', title: 'Catch up' });
	});

	it('remembers a shared link, sees the pick, and shows "Leo picked …" with a calendar link', async () => {
		await db.settings.put({ ...defaultSettings(), myName: 'Sid' });
		await db.people.add(mkPerson({ id: 'leo', name: 'Leo' }));
		let picked: number | null = null;
		const relay = mockRelay(
			() => null,
			(path) => {
				if (path === '/api/invite') return { ok: true, id: 'inv1', url: '/p/inv1' };
				if (path === '/api/invite/inv1') return { id: 'inv1', fromName: 'Sid', title: 'Catch up with Sid', slots: [sat, sun], timeZone: 'UTC', pickedIndex: picked, expiresAt: '2026-11-09T09:00:00Z' };
				throw new Error('unexpected ' + path);
			}
		);
		vi.stubGlobal('location', { origin: 'https://kizuna.example' });
		await createInvite('leo', [sat, sun]);
		const s = await db.settings.get('me');
		expect(s!.pickInvites).toHaveLength(1);
		expect(openInvites(s!.pickInvites!)).toHaveLength(1);

		expect(await checkInvites()).toBe(0);
		expect(await picksToday()).toEqual([]);

		picked = 0;
		expect(await checkInvites()).toBe(1);
		const lines = await picksToday();
		expect(lines).toHaveLength(1);
		expect(lines[0]).toMatchObject({ name: 'Leo', personId: 'leo', text: 'Leo picked Sat 7 Nov, 10:00' });
		expect(lines[0].calendarUrl).toContain('calendar.google.com');

		// Picked invites are not asked about again.
		const asked = relay.calls.filter((c) => c.path === '/api/invite/inv1').length;
		await checkInvites();
		expect(relay.calls.filter((c) => c.path === '/api/invite/inv1').length).toBe(asked);

		await closePick('inv1');
		expect(await picksToday()).toEqual([]);
	});

	it('forgets an invite the relay no longer has, and skips expired ones', async () => {
		await recordInvite({ id: 'gone', personId: 'leo', personName: 'Leo', title: 'Catch up', slots: [sat] });
		await recordInvite({ id: 'old', personId: 'leo', personName: 'Leo', title: 'Catch up', slots: [sat], expiresAt: '2026-11-01T00:00:00Z' });
		const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: false, error: 'not_found' }), { status: 404 }));
		vi.stubGlobal('fetch', fetchMock);
		await checkInvites();
		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect((await db.settings.get('me'))!.pickInvites!.map((i) => i.id)).toEqual(['old']);
	});

	it('stops showing a pick once its time has passed', () => {
		const list = [{ id: 'a', personId: 'leo', personName: 'Leo', title: 'Catch up', slots: [sat], createdAt: '', expiresAt: '', pickedIndex: 0 }];
		expect(pickedLines(list, Date.parse('2026-11-07T05:00:00Z'))).toHaveLength(1);
		expect(pickedLines(list, Date.parse('2026-11-07T06:00:00Z'))).toHaveLength(0);
	});
});
