import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bestWeekendSlot } from '@kizuna/shared';
import { route } from '../src/index.ts';
import { resetAllLimits } from '../src/ratelimit.ts';
import { checkWeekendInput, runWeekend, MAX_ROUNDS, WeekendInputError } from '../src/weekend.ts';
import { completion, makeEnv, post } from './helpers.ts';
import { sampleWeekend as input } from './weekend-fixture.ts';

function call(id: string, name: string, args: unknown) {
	return { id, type: 'function', function: { name, arguments: typeof args === 'string' ? args : JSON.stringify(args) } };
}
const bodyOf = (init: any) => JSON.parse(init.body);
/** Tool results of the last turn, keyed by tool_call_id. */
function toolResults(init: any): Record<string, any> {
	const out: Record<string, any> = {};
	for (const m of bodyOf(init).messages) if (m.role === 'tool') out[m.tool_call_id] = JSON.parse(m.content);
	return out;
}

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
	resetAllLimits();
	fetchMock = vi.fn();
	vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe('weekend tool loop', () => {
	it('runs parallel tools from the input, then finish by id', async () => {
		let results: Record<string, any> = {};
		fetchMock
			.mockImplementationOnce(async (_u: string, init: any) => {
				const b = bodyOf(init);
				expect(b.tools.map((t: any) => t.function.name)).toEqual(['get_windows', 'get_occasions', 'get_local_time', 'get_reasons', 'finish']);
				expect(b.response_format).toBeUndefined();
				expect(b.messages[0].content.split('\n')[0]).toBe('kizuna-task: weekend');
				return completion({
					tool_calls: [
						call('a', 'get_windows', { person_ids: [], from: '2026-10-31', to: '2026-11-01' }),
						call('b', 'get_occasions', { from: '2026-10-30', to: '2026-11-09' }),
						call('c', 'get_reasons', { person_id: 'kabir' })
					]
				});
			})
			.mockImplementationOnce(async (_u: string, init: any) => {
				results = toolResults(init);
				const sun10 = results.a.slots.find((s: any) => s.start === '2026-11-01T10:00:00+05:30');
				return completion({
					tool_calls: [call('d', 'get_local_time', { person_id: 'kabir', at: sun10.id })]
				});
			})
			.mockImplementationOnce(async (_u: string, init: any) => {
				const r = toolResults(init);
				expect(r.d).toMatchObject({ person_id: 'kabir', local: '00:30', weekday: 'Sunday', quiet_hours: true });
				const sun10 = results.a.slots.find((s: any) => s.start === '2026-11-01T10:00:00+05:30');
				const sat = results.a.slots.find((s: any) => s.person_ids.includes('kabir'));
				return completion({
					tool_calls: [
						call('e', 'finish', {
							slot_id: sun10.id,
							person_ids: ['mum', 'papa', 'riya'],
							skipped: [{ person_id: 'kabir', why: "He's asleep then.", alt_slot_id: sat.id }],
							reason: "It's Diwali morning.",
							occasion: 'Diwali'
						})
					]
				});
			});
		const { output, usage } = await runWeekend(makeEnv(), input);
		expect(fetchMock).toHaveBeenCalledTimes(3);
		// Tool results came from the input only.
		expect(results.a.people.map((p: any) => p.person_id)).toEqual(['mum', 'papa', 'riya', 'kabir', 'meera']);
		expect(results.a.slots[0].person_ids).toEqual(['mum', 'papa', 'riya']);
		expect(results.b.occasions).toEqual([{ day: '2026-11-01', name: 'Diwali', kind: 'festival', people: [] }]);
		expect(results.c).toEqual({ person_id: 'kabir', reasons: ['Kabir started a new job.'] });
		expect(output).toEqual({
			slot: { start: '2026-11-01T10:00:00+05:30', end: '2026-11-01T11:00:00+05:30', label: 'Sun 1 Nov, 10:00 to 11:00' },
			personIds: ['mum', 'papa', 'riya'],
			skipped: [{ personId: 'kabir', why: "He's asleep then.", alt: { start: '2026-10-31T19:30:00+05:30', end: '2026-10-31T20:30:00+05:30', label: 'Sat 31 Oct, 19:30 to 20:30' } }],
			reason: "It's Diwali morning.",
			occasion: 'Diwali',
			tools_used: ['get_windows', 'get_occasions', 'get_reasons', 'get_local_time', 'finish']
		});
		expect(usage).toEqual({ input_tokens: 30, output_tokens: 15 });
	});

	it('drops people who are not really free, and unknown ids and occasions', async () => {
		fetchMock
			.mockResolvedValueOnce(completion({ tool_calls: [call('a', 'get_windows', { person_ids: ['mum', 'papa', 'riya', 'kabir'], from: '2026-11-01', to: '2026-11-01' })] }))
			.mockImplementationOnce(async (_u: string, init: any) => {
				const slot = toolResults(init).a.slots.find((s: any) => s.start === '2026-11-01T11:00:00+05:30');
				return completion({
					tool_calls: [call('b', 'finish', { slot_id: slot.id, person_ids: ['mum', 'papa', 'riya', 'kabir', 'ghost'], skipped: [], reason: 'Sunday works.', occasion: 'Holi' })]
				});
			});
		const { output } = await runWeekend(makeEnv(), input);
		expect(output.personIds).toEqual(['mum', 'papa', 'riya']);
		expect(output.skipped).toEqual([{ personId: 'kabir', why: 'Not free then.', alt: null }]);
		expect(output.occasion).toBeNull();
	});

	it('clamps get_windows to the next 7 days and keeps quiet hours out', async () => {
		fetchMock
			.mockResolvedValueOnce(completion({ tool_calls: [call('a', 'get_windows', { person_ids: ['kabir'], from: '2020-01-01', to: '2030-01-01' })] }))
			.mockImplementationOnce(async (_u: string, init: any) => {
				const r = toolResults(init).a;
				expect(r.from).toBe('2026-10-30');
				expect(r.to).toBe('2026-11-06');
				expect(r.people).toHaveLength(1);
				for (const s of r.slots) {
					expect(s.person_ids).toEqual(['kabir']);
					const h = Number(s.start.slice(11, 13));
					expect(h >= 8 && h < 22).toBe(true); // the user's own quiet hours
				}
				return completion({ tool_calls: [call('b', 'finish', { slot_id: null, person_ids: [], skipped: [], reason: 'Nothing fits.', occasion: null })] });
			});
		const { output } = await runWeekend(makeEnv(), input);
		expect(output.slot).toBeNull();
		expect(output.reason).toBe('Nothing fits.');
		expect(output.tools_used).toEqual(['get_windows', 'finish']);
	});

	it('asks again once after a made-up slot id, then falls back', async () => {
		fetchMock.mockImplementation(async () => completion({ tool_calls: [call('x', 'finish', { slot_id: 'w99', person_ids: ['mum'], skipped: [], reason: 'x', occasion: null })] }));
		const { output } = await runWeekend(makeEnv(), input);
		expect(fetchMock).toHaveBeenCalledTimes(2);
		const second = bodyOf(fetchMock.mock.calls[1][1]);
		expect(JSON.parse(second.messages.at(-1).content)).toMatchObject({ ok: false });
		expect(output).toEqual({ ...bestWeekendSlot(input), tools_used: ['finish', 'finish'] });
	});

	it('falls back to bestWeekendSlot when the model is down', async () => {
		fetchMock.mockResolvedValue(new Response('down', { status: 503 }));
		const { output } = await runWeekend(makeEnv(), input);
		expect(output).toEqual(bestWeekendSlot(input));
		expect(output.slot?.start).toBe('2026-11-01T10:00:00+05:30');
	});

	it(`stops after ${MAX_ROUNDS} rounds`, async () => {
		fetchMock.mockImplementation(async () => completion({ tool_calls: [call('c', 'get_reasons', '{bad')] }));
		const { output } = await runWeekend(makeEnv(), input);
		expect(fetchMock).toHaveBeenCalledTimes(MAX_ROUNDS);
		expect(output.tools_used).toHaveLength(MAX_ROUNDS);
		expect(output.slot).not.toBeNull();
	});

	it('answers unknown tools and people with an error', async () => {
		fetchMock
			.mockResolvedValueOnce(completion({ tool_calls: [call('a', 'read_notes', {}), call('b', 'get_reasons', { person_id: 'ghost' }), call('c', 'get_local_time', { person_id: 'me', at: 'later' })] }))
			.mockImplementationOnce(async (_u: string, init: any) => {
				const r = toolResults(init);
				expect(r.a).toEqual({ error: 'unknown tool' });
				expect(r.b).toEqual({ error: 'unknown person_id' });
				expect(r.c.error).toBeTruthy();
				return completion({ content: 'done' });
			});
		const { output } = await runWeekend(makeEnv(), input);
		expect(output.tools_used).toEqual(['get_reasons', 'get_local_time']);
	});
});

describe('weekend input', () => {
	it('trims and defaults', () => {
		const c = checkWeekendInput({ ...input, minMinutes: 5, reasons: [...Array(5)].map((_, i) => ({ personId: 'kabir', text: `r${i}` })) });
		expect(c.minMinutes).toBe(15);
		expect(c.reasons).toHaveLength(3);
	});
	it('rejects bad input', () => {
		expect(() => checkWeekendInput({ ...input, timeZone: 'Moon/Base' })).toThrow(WeekendInputError);
		expect(() => checkWeekendInput({ ...input, people: [...Array(9)].map((_, i) => ({ ...input.people[0], id: `p${i}` })) })).toThrow(WeekendInputError);
		expect(() => checkWeekendInput({ ...input, people: [input.people[0], input.people[0]] })).toThrow(WeekendInputError);
		expect(() => checkWeekendInput({ ...input, people: [{ ...input.people[0], id: 'me' }] })).toThrow(WeekendInputError);
		expect(() => checkWeekendInput({ ...input, me: { ...input.me, windows: [{ start: 'x', end: 'y' }] } })).toThrow(WeekendInputError);
	});
	it('serves through /api/spark, with 400 for bad input', async () => {
		fetchMock.mockResolvedValue(new Response('down', { status: 503 }));
		const ok = await route(post('/api/spark', { task: 'weekend', input }), makeEnv());
		expect(ok.status).toBe(200);
		expect(((await ok.json()) as any).output.personIds).toEqual(['mum', 'papa', 'riya']);
		const bad = await route(post('/api/spark', { task: 'weekend', input: { ...input, now: 'soon' } }), makeEnv());
		expect(bad.status).toBe(400);
	});
});
