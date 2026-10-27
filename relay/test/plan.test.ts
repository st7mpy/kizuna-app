import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { completion, makeEnv, post } from './helpers.ts';

const buildTask = vi.fn();
vi.mock('@kizuna/shared', async (importOriginal) => {
	const real = await importOriginal<typeof import('@kizuna/shared')>();
	return { ...real, buildTask: (...a: unknown[]) => buildTask(...a) };
});

const { route } = await import('../src/index.ts');
const { resetAllLimits } = await import('../src/ratelimit.ts');
const { runPlan, fallbackSlots } = await import('../src/plan.ts');

const input = {
	request: 'next weekend, not Sunday',
	now: '2026-11-02T09:00:00+05:30', // Monday
	timeZone: 'Asia/Kolkata',
	freeHours: [
		{ day: 6, start: '09:00', end: '20:00' },
		{ day: 0, start: '09:00', end: '20:00' },
		{ day: 3, start: '18:00', end: '21:00' }
	],
	busy: [{ start: '2026-11-07T03:30:00Z', end: '2026-11-07T05:30:00Z' }], // Sat 09:00-11:00 IST
	durationMinutes: 60
};

function toolCall(id: string, name: string, args: unknown) {
	return { id, type: 'function', function: { name, arguments: typeof args === 'string' ? args : JSON.stringify(args) } };
}

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
	resetAllLimits();
	buildTask.mockReset();
	buildTask.mockReturnValue({
		messages: [{ role: 'system', content: 'plan' }, { role: 'user', content: 'x' }],
		tools: [{ type: 'function', function: { name: 'free_slots' } }, { type: 'function', function: { name: 'finish' } }],
		reasoning_effort: 'low',
		max_tokens: 1500
	});
	fetchMock = vi.fn();
	vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe('plan tool loop', () => {
	it('runs free_slots with the user data, then finish by ids', async () => {
		let offered: any;
		fetchMock
			.mockImplementationOnce(async (_u: string, init: any) => {
				const body = JSON.parse(init.body);
				expect(body.tools).toHaveLength(2);
				expect(body.tool_choice).toBe('auto');
				expect(body.response_format).toBeUndefined();
				return completion({ tool_calls: [toolCall('c1', 'free_slots', { from: '2026-11-07', to: '2026-11-08', partOfDay: null, excludeWeekdays: [0] })] });
			})
			.mockImplementationOnce(async (_u: string, init: any) => {
				const body = JSON.parse(init.body);
				const tool = body.messages.at(-1);
				expect(tool.role).toBe('tool');
				expect(tool.tool_call_id).toBe('c1');
				offered = JSON.parse(tool.content);
				expect(body.messages.at(-2).tool_calls[0].id).toBe('c1');
				return completion({ tool_calls: [toolCall('c2', 'finish', { slot_ids: [offered.slots[3].id, offered.slots[0].id], note: 'null' })] }); // the live model wrote the word
			});
		const { output, usage } = await runPlan(makeEnv(), input);
		expect(fetchMock).toHaveBeenCalledTimes(2);
		// Saturday only, after the busy block, sampled down to 12.
		expect(offered.total).toBe(17); // 11:00 .. 19:00 every 30 min
		expect(offered.slots).toHaveLength(12);
		for (const s of offered.slots) expect(s.label.startsWith('Sat 7 Nov')).toBe(true);
		expect(offered.slots[0].start).toBe('2026-11-07T11:00:00+05:30');
		expect(output.slots.map((s) => s.start)).toEqual([offered.slots[3].start, offered.slots[0].start]);
		expect(output.note).toBeNull();
		expect(usage).toEqual({ input_tokens: 20, output_tokens: 10 });
	});

	it('clamps tool ranges to today .. +21 days', async () => {
		fetchMock
			.mockResolvedValueOnce(completion({ tool_calls: [toolCall('c1', 'free_slots', { from: '2020-01-01', to: '2030-01-01', partOfDay: 'evening', excludeWeekdays: [] })] }))
			.mockImplementationOnce(async (_u: string, init: any) => {
				const r = JSON.parse(JSON.parse(init.body).messages.at(-1).content);
				expect(r.slots[0].start >= '2026-11-04').toBe(true);
				expect(r.slots.at(-1).start <= '2026-11-23T23:59').toBe(true);
				return completion({ tool_calls: [toolCall('c2', 'finish', { slot_ids: [r.slots[0].id], note: 'Evenings only.' })] });
			});
		const { output } = await runPlan(makeEnv(), input);
		expect(output.slots).toHaveLength(1);
		expect(output.note).toBe('Evenings only.');
	});

	it('falls back to two spread slots in the next 7 days when the model fails', async () => {
		fetchMock.mockResolvedValue(new Response('down', { status: 503 }));
		const { output } = await runPlan(makeEnv(), input);
		expect(output.slots).toHaveLength(2);
		expect(output.slots[0].start).toBe('2026-11-04T18:00:00+05:30'); // Wed evening
		expect(output.slots[1].start.slice(0, 10)).toBe('2026-11-07');
		expect(output.slots).toEqual(fallbackSlots(input as any));
	});

	it('falls back when finish names slots it was never offered, keeping the note', async () => {
		fetchMock
			.mockResolvedValueOnce(completion({ tool_calls: [toolCall('c1', 'finish', { slot_ids: ['s99'], note: 'Saturday is full; here is another day.' })] }));
		const { output } = await runPlan(makeEnv(), input);
		expect(output.slots).toHaveLength(2);
		expect(output.note).toBe('Saturday is full; here is another day.');
	});

	it('stops after 4 rounds of tool calls', async () => {
		fetchMock.mockImplementation(async () => completion({ tool_calls: [toolCall('c', 'free_slots', '{bad json')] }));
		const { output } = await runPlan(makeEnv(), input);
		expect(fetchMock).toHaveBeenCalledTimes(4);
		expect(output.slots).toHaveLength(2);
	});

	it('falls back when the model answers with text', async () => {
		fetchMock.mockResolvedValueOnce(completion({ content: 'Saturday works!' }));
		const { output } = await runPlan(makeEnv(), input);
		expect(output.slots).toHaveLength(2);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it('serves through /api/spark and rejects bad plan input', async () => {
		fetchMock.mockResolvedValue(new Response('down', { status: 503 }));
		const ok = await route(post('/api/spark', { task: 'plan', input }), makeEnv());
		expect(((await ok.json()) as any).output.slots).toHaveLength(2);
		const bad = await route(post('/api/spark', { task: 'plan', input: { ...input, timeZone: 'Moon/Base' } }), makeEnv());
		expect(bad.status).toBe(400);
		const bad2 = await route(post('/api/spark', { task: 'plan', input: { ...input, freeHours: [{ day: 9, start: '1', end: '2' }] } }), makeEnv());
		expect(bad2.status).toBe(400);
	});
});
