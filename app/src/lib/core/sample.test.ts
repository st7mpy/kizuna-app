import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db, defaultSettings } from '../db.ts';
import { exportNotes, deleteEverything, notesMarkdown } from './data.ts';
import { fetchSampleLife, loadSampleLifeFrom, refreshSampleMembers, refreshStaleSample, sampleStatuses, resolveRel, SAMPLE_VERSION, SAMPLES, staleSample, type SampleLife } from './sample.ts';
import { answerLines, followUps } from './answers.ts';
import { deviceId } from './relay.ts';
import { todayCards } from './today.ts';
import { resetDb, setOffline } from './testing.ts';

const NOW = new Date(2026, 9, 26, 10, 0); // Monday

const tiny: SampleLife = {
	myName: 'Alex',
	notes: [
		{
			daysAgo: 20, time: '08:40', source: 'voice',
			text: 'Talked to Grandma, should call her again on Sunday',
			extract: { language: 'en', sensitive: false, people: [{ name: 'Grandma', relation: 'family' }], events: [], promises: [], threads: [], gift_hints: [] }
		},
		{
			daysAgo: 2, time: '21:10', source: 'voice',
			text: 'Mom has a knee appointment Thursday, Jordan started his new job, should call him',
			extract: {
				language: 'en', sensitive: true,
				people: [{ name: 'Mom', relation: 'parent' }, { name: 'Jordan', relation: 'friend' }],
				events: [
					{ what: 'knee appointment', kind: 'appointment', people: ['Mom'], date: 'rel:3', time: null, date_text: 'Thursday' },
					{ what: 'started new job', kind: 'milestone', people: ['Jordan'], date: 'rel:-1', time: null, date_text: null }
				],
				promises: [{ what: 'Call Jordan', person: 'Jordan', date_text: null }],
				threads: [],
				gift_hints: []
			}
		},
		{
			daysAgo: 1, time: '19:00', source: 'typed',
			text: 'Mommy said the appointment moved. Lake trip idea with Ben',
			extract: {
				language: 'en', sensitive: true,
				people: [{ name: 'Mommy', relation: 'parent' }, { name: 'Ben', relation: 'friend' }],
				events: [],
				promises: [],
				threads: [{ title: 'Lake trip', kind: 'plan', people: ['Ben'] }],
				gift_hints: []
			}
		}
	],
	weave: {
		people: [
			{ id: null, name: 'Mom', aliases: ['mom', 'mommy', 'ma'], merge_ids: [], relation: 'parent', closeness: 'inner', suggest_circle: true, why: 'Family, comes up most', summary: 'Busy week' },
			{ id: null, name: 'Jordan', aliases: ['jordan'], merge_ids: [], relation: 'friend', closeness: 'close', suggest_circle: true, why: 'College friend, new job', summary: 'New job since Sunday' },
			{ id: null, name: 'Grandma', aliases: ['grandma'], merge_ids: [], relation: 'family', closeness: 'inner', suggest_circle: true, why: 'Sunday calls', summary: 'Sunday calls' },
			{ id: null, name: 'Ben', aliases: ['ben'], merge_ids: [], relation: 'friend', closeness: 'close', suggest_circle: true, why: 'Flatmate, moving out', summary: 'Moving out soon' }
		],
		threads: [{ title: 'Lake trip', kind: 'plan', people: ['Ben'], note_ids: ['2'], status: 'open' }]
	},
	phones: { Jordan: '13125550101' }
};

beforeEach(async () => {
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(NOW);
	setOffline(true);
	await resetDb();
});
afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

describe('sample life', () => {
	it('resolves rel:N days', () => {
		expect(resolveRel('rel:3', '2026-10-26')).toBe('2026-10-29');
		expect(resolveRel('rel:-2', '2026-10-26')).toBe('2026-10-24');
		expect(resolveRel(null, '2026-10-26')).toBeNull();
		expect(resolveRel('2026-12-01', '2026-10-26')).toBe('2026-12-01');
	});

	it('loads notes, people, events, threads and settings, ready for Today', async () => {
		await db.fragments.add({ id: 'old', text: 'my real note', createdAt: NOW.toISOString(), source: 'typed', status: 'done', tries: 0 });
		await db.settings.put({ ...defaultSettings(), relayUrl: 'http://localhost:8787' });
		await loadSampleLifeFrom(tiny);

		const frags = await db.fragments.toArray();
		expect(frags).toHaveLength(3);
		expect(frags.every((f) => f.status === 'done')).toBe(true);
		const first = frags.find((f) => f.text.startsWith('Talked to Grandma'))!;
		expect(new Date(first.createdAt)).toEqual(new Date(2026, 9, 6, 8, 40));

		const people = await db.people.toArray();
		expect(people.map((p) => p.name).sort()).toEqual(['Ben', 'Grandma', 'Jordan', 'Mom']);
		const mom = people.find((p) => p.name === 'Mom')!;
		expect(mom.aliases).toEqual(expect.arrayContaining(['mom', 'mommy', 'ma']));
		expect(mom.mentions).toBe(2);
		const jordan = people.find((p) => p.name === 'Jordan')!;
		expect(jordan).toMatchObject({ phone: '13125550101', circle: 'in', summary: 'New job since Sunday' });
		expect(people.find((p) => p.name === 'Ben')!.circle).toBe('suggested');

		const knee = (await db.events.toArray()).find((e) => e.what === 'knee appointment')!;
		expect(knee).toMatchObject({ day: '2026-10-29', dateConfidence: 'sure', personIds: [mom.id] });
		const lake = (await db.threads.toArray()).find((t) => t.title === 'Lake trip')!;
		expect(lake.fragmentIds).toEqual([frags.find((f) => f.text.startsWith('Mommy'))!.id]);

		const s = (await db.settings.get('me'))!;
		expect(s).toMatchObject({ myName: 'Alex', relayUrl: 'http://localhost:8787', notesSinceWeave: 0 });

		const cards = await todayCards();
		expect(cards.map((c) => c.title)).toEqual(['Jordan', 'Mom', 'Grandma']);
	});

	it('offers two samples, the working family first', () => {
		expect(SAMPLES.map((x) => x.key)).toEqual(['abroad', 'usa']);
		for (const x of SAMPLES) expect(x.label + x.blurb).not.toMatch(/hindi|hinglish|india/i);
	});

	for (const key of ['abroad', 'usa'] as const) {
		it(`${key}: loads so Today has cards at once, with a weekend plan and a gift card on a weekday`, async () => {
			const life = await fetchSampleLife(key);
			expect(life.id).toBe(key);
			vi.setSystemTime(new Date(2026, 9, 27, 12, 0)); // Tuesday
			await loadSampleLifeFrom(life);
			expect(await db.fragments.count()).toBe(life.notes.length);
			const people = await db.people.toArray();
			expect(people.filter((p) => p.circle === 'in').length).toBe(life.circle!.length);
			expect(people.some((p) => p.circle === 'suggested')).toBe(true);
			expect(people.filter((p) => p.relation === 'parent').length).toBeLessThanOrEqual(2);
			const { setRoom } = await import('./settings.ts');
			await setRoom('lots');
			const cards = await todayCards();
			expect(cards.filter((c) => c.kind === 'person').length).toBeGreaterThanOrEqual(2);
			expect(cards.map((c) => c.reason).join(' ')).not.toMatch(/\d+ days?/);
			const { todayExtras } = await import('./today.ts');
			const extras = await todayExtras();
			expect(extras.weekend).not.toBeNull();
			expect(extras.gifts).toHaveLength(1);
		});
	}

	for (const [key, waiting] of [['abroad', 'Jordan'], ['usa', 'Kai']] as const) {
		for (const day of [26, 27, 28, 29]) {
			it(`${key}: shows an answer and a "hasn't answered" line on a weekday (Oct ${day})`, async () => {
				vi.setSystemTime(new Date(`2026-10-${day}T15:00:00Z`));
				await loadSampleLifeFrom(await fetchSampleLife(key));
				expect((await answerLines()).map((l) => l.text)).toEqual(['Grandma answered: Sunday afternoon']);
				expect((await followUps()).map((f) => f.text)).toEqual([`${waiting} hasn't answered yet`]);
				// late at night too
				vi.setSystemTime(new Date(`2026-10-${day}T05:00:00Z`));
				expect((await followUps()).length).toBe(1);
			});
		}
	}

	it('marks its notes and its version, so a newer sample can replace it', async () => {
		await loadSampleLifeFrom(await fetchSampleLife('usa'));
		expect(new Set((await db.fragments.toArray()).map((f) => f.source))).toEqual(new Set(['sample']));
		expect((await db.settings.get('me'))!.sample).toEqual({ key: 'usa', version: SAMPLE_VERSION });
	});

	it('knows an outdated sample from the visitor\'s own notes', () => {
		const sample = [{ source: 'sample' as const }];
		const base = { myName: 'Alex', notesSinceWeave: 0 };
		expect(staleSample(undefined, sample)).toBe(false);
		expect(staleSample({ ...base, sample: { key: 'usa', version: SAMPLE_VERSION } }, sample)).toBe(false);
		expect(staleSample({ ...base, sample: { key: 'usa', version: SAMPLE_VERSION - 1 } }, sample)).toBe(true);
		expect(staleSample({ ...base, sample: { key: 'usa', version: SAMPLE_VERSION - 1 } }, [...sample, { source: 'typed' }])).toBe(false);
		// from before versions: a local sample circle or Aarav's sample, with nothing added
		const old = Array.from({ length: 40 }, () => ({ source: 'voice' as const }));
		const circle = { id: 'sample', key: '', memberId: 'sample-me000', share: true, freeToday: true, paused: false };
		expect(staleSample({ myName: 'Aarav', notesSinceWeave: 0 }, old)).toBe(true);
		expect(staleSample({ myName: 'Alex', notesSinceWeave: 0, circle }, old)).toBe(true);
		expect(staleSample({ myName: 'Aarav', notesSinceWeave: 1 }, old)).toBe(false);
		expect(staleSample({ myName: 'Aarav', notesSinceWeave: 0 }, [...old, ...old])).toBe(false);
		expect(staleSample({ myName: 'Priya', notesSinceWeave: 0 }, old)).toBe(false);
		expect(staleSample({ myName: 'Aarav', notesSinceWeave: 0 }, [])).toBe(false);
	});

	it('quietly replaces the old Aarav sample with the current default one', async () => {
		await db.settings.put({ ...defaultSettings(), myName: 'Aarav', notesSinceWeave: 0 });
		await db.fragments.bulkAdd([
			{ id: 'a', text: 'Mum ka knee appointment Thursday hai', createdAt: NOW.toISOString(), source: 'voice', status: 'done', tries: 0 },
			{ id: 'b', text: 'Kabir joined a new job', createdAt: NOW.toISOString(), source: 'typed', status: 'done', tries: 0 }
		]);
		expect(await refreshStaleSample()).toBe(true);
		const s = (await db.settings.get('me'))!;
		expect(s.myName).toBe('Alex');
		expect(s.sample).toEqual({ key: 'abroad', version: SAMPLE_VERSION });
		expect(JSON.stringify(await db.fragments.toArray())).not.toMatch(/knee|Kabir|Aarav/);
		expect(await refreshStaleSample()).toBe(false); // current now
	});

	it('leaves real notes alone', async () => {
		await db.settings.put({ ...defaultSettings(), myName: 'Priya' });
		await db.fragments.add({ id: 'a', text: 'Call Mum on Sunday', createdAt: NOW.toISOString(), source: 'typed', status: 'done', tries: 0 });
		expect(await refreshStaleSample()).toBe(false);
		expect(await db.fragments.count()).toBe(1);
	});

	it('abroad: a busy family in Chicago and New York, Leo a day ahead in Melbourne', async () => {
		vi.setSystemTime(new Date(Date.UTC(2026, 9, 27, 17, 0))); // Tuesday, midday in Chicago (nobody glows at night)
		await loadSampleLifeFrom(await fetchSampleLife('abroad'));
		const { buildMapView } = await import('./map.ts');
		const map = await buildMapView();
		expect(map.sharing).toBe(true);
		expect(map.people.map((p) => p.person.name).sort()).toEqual(['Dad', 'Grandma', 'Jordan', 'Leo', 'Maya', 'Mom']);
		const by = (n: string) => map.people.find((p) => p.person.name === n)!;
		expect(by('Mom')).toMatchObject({ ring: 'inner', tz: 'America/Chicago', glow: 'open' });
		expect(by('Maya')).toMatchObject({ tz: 'America/New_York', glow: 'maybe' });
		expect(by('Leo')).toMatchObject({ ring: 'inner', tz: 'Australia/Melbourne' });
		expect(by('Jordan')).toMatchObject({ ring: 'outer', tz: 'America/Los_Angeles', glow: null });
		expect(by('Dad').hasGift).toBe(true);
		expect(by('Dad').occasion?.name).toBe("Dad's birthday");
		const grandma = (await db.members.toArray()).find((m) => m.entry.name === 'Grandma')!;
		expect(grandma.reply).toBe('Sunday afternoon works for me');

		const name = (id: string) => map.people.find((p) => p.person.id === id)!.person.name;
		const { weekendCard } = await import('./weekend.ts');
		const card = (await weekendCard())!;
		expect(card.personIds.map(name)).toEqual(expect.arrayContaining(['Mom', 'Dad', 'Grandma']));
		// Sunday afternoon at home is Monday morning in Melbourne: Leo is offered his own time
		const leo = card.skipped.find((x) => name(x.personId) === 'Leo')!;
		expect(leo).toBeTruthy();
		expect(card.personIds.map(name)).not.toContain('Leo');
		// Jordan hasn't answered yet (Today says so): the plan doesn't count him free or offer him a time
		expect([...card.personIds, ...card.skipped.map((x) => x.personId)].map(name)).not.toContain('Jordan');
		const { giftCards } = await import('./gifts.ts');
		const [gift] = await giftCards();
		expect(gift).toMatchObject({ daysLeft: 9 });
		expect(gift.hint.what).toBe('new running shoes');
		expect(name(gift.withPersonId!)).toBe('Maya');
	});

	it('usa: eight relatives over six zones, one Sunday time that works for most', async () => {
		vi.setSystemTime(new Date(2026, 9, 27, 12, 0)); // Tuesday
		await loadSampleLifeFrom(await fetchSampleLife('usa'));
		const { buildMapView } = await import('./map.ts');
		const map = await buildMapView();
		expect(map.people.map((p) => p.person.name).sort()).toEqual(['Aunt Carmen', 'Grandma', 'Grandpa', 'Kai', 'Mia', 'Mom', 'Tyler', 'Uncle Dave']);
		const by = (n: string) => map.people.find((p) => p.person.name === n)!;
		expect(new Set(map.people.map((p) => p.tz)).size).toBe(7);
		expect(by('Kai').tz).toBe('Pacific/Honolulu');
		expect(by('Grandpa').hasGift).toBe(true);
		expect(by('Grandpa').occasion?.name).toBe("Grandpa's birthday");
		const grandma = (await db.members.toArray()).find((m) => m.entry.name === 'Grandma')!;
		expect(grandma.reply).toBe('Sunday afternoon works for me');

		const name = (id: string) => map.people.find((p) => p.person.id === id)!.person.name;
		const { weekendCard } = await import('./weekend.ts');
		const card = (await weekendCard())!;
		const free = card.personIds.map(name);
		expect(free.length).toBeGreaterThanOrEqual(5);
		expect(new Set(free.map((n) => by(n).tz)).size).toBeGreaterThanOrEqual(3);
		expect(card.skipped.map((x) => name(x.personId))).toContain('Tyler');
		// Kai hasn't answered yet: not counted as free, and not offered another time either
		expect(free).not.toContain('Kai');
		expect(card.skipped.map((x) => name(x.personId))).not.toContain('Kai');
		const { giftCards } = await import('./gifts.ts');
		const [gift] = await giftCards();
		expect(gift).toMatchObject({ daysLeft: 8 });
		expect(gift.hint.what).toBe('binoculars for birdwatching');
		expect(name(gift.withPersonId!)).toBe('Grandma');
	});

	it('plans in the family\'s home city, whatever zone the visitor is in', async () => {
		const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;
		const was = env.TZ;
		const { weekendCard } = await import('./weekend.ts');
		const { giftCards } = await import('./gifts.ts');
		const { buildMapView } = await import('./map.ts');
		const { localDay, homeZone } = await import('./days.ts');
		try {
			for (const tz of ['Asia/Kolkata', 'Asia/Tokyo', 'Europe/London', 'America/Los_Angeles', 'UTC']) {
				env.TZ = tz;
				for (const key of ['abroad', 'usa'] as const) {
					vi.setSystemTime(new Date('2026-10-27T12:00:00Z')); // Tue 07:00 in Chicago
					await resetDb();
					await loadSampleLifeFrom(await fetchSampleLife(key));
					expect(homeZone()).toBe('America/Chicago');
					expect(localDay()).toBe('2026-10-27');
					const map = await buildMapView();
					expect(map.me).toMatchObject({ tz: 'America/Chicago', localTime: '07:00' });
					const name = (id: string) => map.people.find((p) => p.person.id === id)!.person.name;
					const card = (await weekendCard())!;
					expect(card.personIds.length, `${tz} ${key}`).toBeGreaterThanOrEqual(4);
					// Sunday early afternoon at home, the same plan from anywhere
					expect(card.slot.label, `${tz} ${key}`).toMatch(/^Sun 1 Nov, 1[34]:\d\d to /);
					const skipped = card.skipped.map((x) => name(x.personId)).sort();
					expect(skipped).toEqual(key === 'abroad' ? ['Leo'] : ['Tyler']);
					expect(card.skipped.every((x) => x.alt)).toBe(true);
					expect((await giftCards())[0].daysLeft).toBe(key === 'abroad' ? 9 : 8);
				}
			}
		} finally {
			env.TZ = was;
		}
		const { deleteEverything } = await import('./data.ts');
		await deleteEverything();
		expect(homeZone()).toBeNull();
	});

	it('exports notes as markdown by day', async () => {
		await loadSampleLifeFrom(tiny);
		const blob = await exportNotes();
		expect(blob.type).toBe('text/markdown;charset=utf-8');
		const md = await blob.text();
		expect(md).toMatch(/^# Kizuna notes\n\n## 2026-10-06\n\n- 08:40 Talked to Grandma/);
		expect(md.indexOf('## 2026-10-24')).toBeLessThan(md.indexOf('## 2026-10-25'));
		expect(notesMarkdown([])).toBe('# Kizuna notes\n\n');
	});

	it('delete everything clears all tables and the device id', async () => {
		const store = new Map<string, string>();
		vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k) });
		const id = deviceId();
		await loadSampleLifeFrom(tiny);
		await deleteEverything();
		for (const t of db.tables) expect(await t.count()).toBe(0);
		expect(deviceId()).not.toBe(id);
	});

	it('a sample loaded days ago still glows and still has a weekend to plan', async () => {
		vi.setSystemTime(new Date(Date.UTC(2026, 9, 27, 17, 0))); // Tuesday, midday in Chicago
		await loadSampleLifeFrom(await fetchSampleLife('abroad'));
		const { buildMapView } = await import('./map.ts');
		const { weekendCard } = await import('./weekend.ts');
		const glows = async () => (await buildMapView()).people.filter((p) => p.glow === 'open').map((p) => p.person.name);
		expect(await glows()).toEqual(['Mom']);
		// three days later, and again eight days later (past that weekend)
		for (const later of [3, 8]) {
			vi.setSystemTime(new Date(Date.UTC(2026, 9, 27 + later, 17, 0)));
			expect(await glows()).toEqual([]); // stale until re-based
			expect(await refreshSampleMembers()).toBe(true);
			expect(await glows()).toEqual(['Mom']);
			expect(await weekendCard()).not.toBeNull();
			// the one still waiting stays waiting: nothing shared, asked after their last entry
			const jordan = (await db.members.toArray()).find((m) => m.entry.name === 'Jordan')!;
			expect(jordan.entry.windows).toEqual([]);
			const p = (await db.people.toArray()).find((x) => x.name === 'Jordan')!;
			expect(Date.parse(p.invitedAt!)).toBeGreaterThan(Date.parse(jordan.entry.updatedAt));
		}
		expect(await refreshSampleMembers()).toBe(false); // fresh: nothing to do
	});

	it('nobody glows at four in the morning; someone awake is open instead', () => {
		const fam = [
			{ name: 'Mom', tz: 'America/Chicago', status: 'free' as const, windows: [] },
			{ name: 'Maya', tz: 'America/New_York', status: 'maybe' as const, windows: [] },
			{ name: 'Leo', tz: 'Australia/Melbourne', status: null, windows: [] }
		];
		// 10:00 UTC: 05:00 in Chicago, 06:00 in New York, 21:00 in Melbourne
		expect(sampleStatuses(fam, new Date('2026-10-27T10:00:00Z'))).toEqual([null, null, 'free']);
		// midday in Chicago: as written
		expect(sampleStatuses(fam, new Date('2026-10-27T17:00:00Z'))).toEqual(['free', 'maybe', null]);
		// a waiting person is never made open
		expect(sampleStatuses(fam, new Date('2026-10-27T10:00:00Z'), new Set(['Leo']))).toEqual([null, null, null]);
	});
});
