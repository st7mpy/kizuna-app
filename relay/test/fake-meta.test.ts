// End to end through the relay with real task building and the local fake model.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SCHEMAS } from '@kizuna/shared';
import { fakeCompletion, fakeExtract, giftHints, planArgs } from '../../tools/fake-meta/fake.ts';
import { sampleWeekend } from './weekend-fixture.ts';
import { route } from '../src/index.ts';
import { resetAllLimits } from '../src/ratelimit.ts';
import { schemaErrors } from '../src/validate.ts';
import { makeEnv, post } from './helpers.ts';

beforeEach(() => {
	resetAllLimits();
	vi.stubGlobal('fetch', async (_url: string, init: any) => {
		const out = fakeCompletion(JSON.parse(init.body));
		return new Response(JSON.stringify(out.json), { status: out.status, headers: { 'content-type': 'application/json' } });
	});
});
afterEach(() => vi.unstubAllGlobals());

const NOTE = "Mum ka knee appointment Thursday hai, Kabir ne naya job join kiya, should call him, and Riya wants to do something for Papa's birthday.";

async function spark(task: string, input: unknown) {
	const res = await route(post('/api/spark', { task, input }), makeEnv());
	return (await res.json()) as any;
}

describe('fake model through the relay', () => {
	it('extract gives people, a dated appointment and a promise', async () => {
		const r = await spark('extract', { text: NOTE, today: '2026-11-02', weekday: 'Monday', knownPeople: [] });
		expect(r.ok).toBe(true);
		expect(schemaErrors(SCHEMAS.extract, r.output)).toBeNull();
		const names = r.output.people.map((p: any) => p.name);
		expect(names).toEqual(expect.arrayContaining(['Mum', 'Kabir', 'Riya', 'Papa']));
		expect(r.output.language).toBe('mixed');
		expect(r.output.sensitive).toBe(true);
		const appt = r.output.events.find((e: any) => e.kind === 'appointment');
		expect(appt).toMatchObject({ date: '2026-11-05', date_text: 'thursday', people: ['Mum'] });
		expect(r.output.events.find((e: any) => e.kind === 'birthday').people).toEqual(['Papa']);
		expect(r.output.promises[0]).toMatchObject({ person: 'Kabir' });
	});

	it('extract reuses known names for aliases', () => {
		const out = fakeExtract(`Today is Monday, 2026-11-02.\n\nKnown people:\n- Mummy (parent), also called: ma, mum\n\nNote:\n"""\nMa called today\n"""`);
		expect(out.people).toEqual([{ name: 'Mummy', relation: 'parent' }]);
	});

	it('weave, draft and rank are schema-valid', async () => {
		const weave = await spark('weave', {
			today: '2026-11-02',
			notes: [
				{ id: 'n1', day: '2026-10-30', text: NOTE },
				{ id: 'n2', day: '2026-11-01', text: 'Mummy ne bola Nani ko Sunday call karna. Kabir sent photos from the new office.' }
			],
			people: [
				{ id: 'p1', name: 'Mum', aliases: ['mum'], relation: 'parent', circle: 'in' },
				{ id: 'p2', name: 'Mummy', aliases: [], relation: 'parent', circle: 'none' }
			]
		});
		expect(weave.ok).toBe(true);
		const mum = weave.output.people.find((p: any) => p.name === 'Mum');
		expect(mum.id).toBe('p1');
		expect(mum.merge_ids).toEqual(['p2']);
		expect(weave.output.people.length).toBeLessThanOrEqual(8);

		const draft = await spark('draft', { personName: 'Kabir', relation: 'friend', reason: 'new job', context: [], myRecentLines: [], language: 'mixed', withTime: 'Sat 7 Nov, 10:00 to 11:00' });
		expect(draft.output.line).toBe('Hey Kabir, been thinking of you. Free for a call Sat 7 Nov, 10:00?');
		expect(draft.output.line).not.toContain('!');

		const rank = await spark('rank', { room: 'low', candidates: [{ id: 'a', title: 'Ishaan', reason: 'moving out' }, { id: 'b', title: 'Papa', reason: 'birthday tomorrow' }] });
		expect(rank.output.order).toEqual(['b', 'a']);
	});

	it('plan runs the tool loop: next weekend, not Sunday', async () => {
		const r = await spark('plan', {
			request: 'next weekend, not Sunday',
			now: '2026-11-02T09:00:00+05:30',
			timeZone: 'Asia/Kolkata',
			freeHours: [
				{ day: 6, start: '10:00', end: '18:00' },
				{ day: 0, start: '10:00', end: '18:00' },
				{ day: 2, start: '19:00', end: '21:00' }
			],
			busy: [],
			durationMinutes: 60
		});
		expect(r.ok).toBe(true);
		expect(r.output.slots.length).toBeGreaterThanOrEqual(1);
		for (const s of r.output.slots) expect(s.label.startsWith('Sat 7 Nov')).toBe(true);
	});

	it('plan widens the range when nothing fits', async () => {
		const r = await spark('plan', {
			request: 'tomorrow evening',
			now: '2026-11-02T09:00:00+05:30',
			timeZone: 'Asia/Kolkata',
			freeHours: [{ day: 6, start: '10:00', end: '18:00' }],
			busy: [],
			durationMinutes: 60
		});
		expect(r.output.slots.length).toBe(2);
		expect(r.output.note).toBeTruthy();
	});

	it('planArgs reads common phrasing', () => {
		const u = (req: string) => `Now: 2026-11-02T09:00:00+05:30 (Asia/Kolkata)\nMeeting length: 60 minutes\nRequest: "${req}"`;
		expect(planArgs(u('next weekend, not Sunday'))).toEqual({ from: '2026-11-07', to: '2026-11-08', partOfDay: null, excludeWeekdays: [0] });
		expect(planArgs(u('kal shaam ko'))).toMatchObject({ from: '2026-11-03', to: '2026-11-03', partOfDay: 'evening' });
		expect(planArgs(u('friday morning'))).toMatchObject({ from: '2026-11-06', partOfDay: 'morning' });
	});

	it('extract finds gift hints, never with prices', async () => {
		const r = await spark('extract', { text: 'Papa wants a brighter reading lamp for his birthday. Riya ko naya yoga mat chahiye.', today: '2026-11-02', weekday: 'Monday', knownPeople: [] });
		expect(schemaErrors(SCHEMAS.extract, r.output)).toBeNull();
		expect(r.output.gift_hints).toEqual([
			{ person: 'Papa', what: 'a brighter reading lamp' },
			{ person: 'Riya', what: 'naya yoga mat' }
		]);
		expect(giftHints('Papa wants a lamp for ₹2000', ['Papa'])).toEqual([]);
		expect(giftHints('Kabir wants to meet', ['Kabir'])).toEqual([]);
	});

	it('windows reads Hinglish replies into guarded windows', async () => {
		const now = '2026-10-30T18:10:00+05:30';
		const sun = await spark('windows', { reply: 'Sunday shaam ko free hoon', now, timeZone: 'Asia/Kolkata' });
		expect(sun.ok).toBe(true);
		expect(schemaErrors(SCHEMAS.windows, sun.output)).toBeNull();
		expect(sun.output).toEqual({ windows: [{ day: '2026-11-01', start: '17:00', end: '20:00' }], not_this_weekend: false, language: 'mixed' });
		const sat = await spark('windows', { reply: 'Sat after lunch, not before 2', now, timeZone: 'Asia/Kolkata' });
		expect(sat.output.windows).toEqual([{ day: '2026-10-31', start: '14:00', end: '16:00' }]);
		const nope = await spark('windows', { reply: 'is weekend nahi ho payega', now, timeZone: 'Asia/Kolkata' });
		expect(nope.output).toMatchObject({ windows: [], not_this_weekend: true });
	});

	it('weekend runs the tool loop to a checked plan', async () => {
		const r = await spark('weekend', sampleWeekend);
		expect(r.ok).toBe(true);
		expect(r.output.slot.start).toBe('2026-11-01T10:00:00+05:30');
		expect(r.output.personIds).toEqual(['mum', 'papa', 'riya']);
		expect(r.output.occasion).toBe('Diwali');
		expect(r.output.tools_used).toEqual(['get_windows', 'get_occasions', ...sampleWeekend.people.map(() => 'get_reasons'), 'finish']);
		expect(r.output.skipped.map((s: any) => s.personId)).toEqual(['kabir']);
		expect(r.output.skipped[0].alt.start).toBe('2026-10-31T19:30:00+05:30');
		const notSun = await spark('weekend', { ...sampleWeekend, request: 'not Sunday, Papa has puja' });
		expect(notSun.output.slot.start.slice(0, 10)).toBe('2026-10-31');
	});
});
