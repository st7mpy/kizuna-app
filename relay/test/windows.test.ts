import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { route } from '../src/index.ts';
import { resetAllLimits } from '../src/ratelimit.ts';
import { checkWindowsInput, guardWindows } from '../src/validate.ts';
import { completion, makeEnv, post } from './helpers.ts';

const input = { reply: 'Sunday shaam ko free hoon', now: '2026-10-30T18:10:00+05:30', timeZone: 'Asia/Kolkata' };

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
	resetAllLimits();
	fetchMock = vi.fn();
	vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe('guardWindows', () => {
	it('drops past, far, backwards and malformed windows, sorts and keeps 3', () => {
		const out = guardWindows(
			{
				windows: [
					{ day: '2026-11-01', start: '17:00', end: '20:00' },
					{ day: '2026-10-29', start: '17:00', end: '20:00' }, // past
					{ day: '2026-10-30', start: '09:00', end: '12:00' }, // ended this morning
					{ day: '2026-11-08', start: '17:00', end: '20:00' }, // more than 7 days out
					{ day: '2026-10-31', start: '20:00', end: '18:00' }, // end before start
					{ day: '2026-10-31', start: '9:00', end: '12:00' },
					{ day: '2026-10-31', start: '09:00', end: '12:00' }, // same again
					{ day: 'Sat', start: '09:00', end: '12:00' },
					{ day: '2026-11-02', start: '25:00', end: '26:00' },
					{ day: '2026-11-03', start: '10:00', end: '11:00' },
					{ day: '2026-11-04', start: '10:00', end: '11:00' }
				],
				not_this_weekend: false,
				language: 'mixed'
			},
			input
		);
		expect(out.windows).toEqual([
			{ day: '2026-10-31', start: '09:00', end: '12:00' },
			{ day: '2026-11-01', start: '17:00', end: '20:00' },
			{ day: '2026-11-03', start: '10:00', end: '11:00' }
		]);
	});
	it('keeps a window that is still running', () => {
		const out = guardWindows({ windows: [{ day: '2026-10-30', start: '17:00', end: '20:00' }], not_this_weekend: false, language: 'en' }, input);
		expect(out.windows).toHaveLength(1);
	});
});

describe('checkWindowsInput', () => {
	it('needs a reply, a time and a zone', () => {
		expect(typeof checkWindowsInput(input)).toBe('object');
		expect(checkWindowsInput({ ...input, reply: ' ' })).toBe('reply');
		expect(checkWindowsInput({ ...input, reply: 'x'.repeat(501) })).toBe('reply too long');
		expect(checkWindowsInput({ ...input, now: 'later' })).toBe('now');
		expect(checkWindowsInput({ ...input, timeZone: 'Moon/Base' })).toBe('timeZone');
	});
});

describe('POST /api/spark windows', () => {
	it('asks with a strict schema and guards the answer', async () => {
		fetchMock.mockImplementationOnce(async (_u: string, init: any) => {
			const b = JSON.parse(init.body);
			expect(b.response_format.json_schema.name).toBe('windows');
			expect(b.response_format.json_schema.strict).toBe(true);
			expect(b.messages[1].content).toContain('Sunday shaam ko free hoon');
			return completion({
				content: JSON.stringify({
					windows: [
						{ day: '2026-11-01', start: '17:00', end: '20:00' },
						{ day: '2026-10-20', start: '17:00', end: '20:00' }
					],
					not_this_weekend: false,
					language: 'mixed'
				})
			});
		});
		const res = await route(post('/api/spark', { task: 'windows', input }), makeEnv());
		expect(res.status).toBe(200);
		expect(((await res.json()) as any).output).toEqual({ windows: [{ day: '2026-11-01', start: '17:00', end: '20:00' }], not_this_weekend: false, language: 'mixed' });
	});
	it('rejects bad input before calling the model', async () => {
		const res = await route(post('/api/spark', { task: 'windows', input: { ...input, timeZone: 'nope' } }), makeEnv());
		expect(res.status).toBe(400);
		expect(fetchMock).not.toHaveBeenCalled();
	});
	it('caps the body size', async () => {
		const res = await route(post('/api/spark', { task: 'windows', input: { ...input, pad: 'x'.repeat(5000) } }), makeEnv());
		expect(res.status).toBe(413);
	});
});
