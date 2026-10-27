import { describe, expect, it } from 'vitest';
import { newWindow, timeOptions, windowProblem } from './freehours.ts';

describe('free hours', () => {
	it('adds a new window after the last one, never on top of it', () => {
		expect(newWindow(1, [])).toEqual({ start: '18:30', end: '20:30' });
		expect(newWindow(6, [])).toEqual({ start: '10:00', end: '12:00' });
		expect(newWindow(1, [{ start: '18:30', end: '21:30' }])).toEqual({ start: '21:30', end: '23:30' });
		// the audit's case: two taps on Monday never give the same or an overlapping window
		const a = newWindow(1, [{ start: '18:30', end: '21:30' }])!;
		const b = newWindow(1, [{ start: '18:30', end: '21:30' }, a]);
		expect(b).not.toBeNull();
		for (const w of [a, b!]) expect(windowProblem(w, [{ start: '18:30', end: '21:30' }])).toBeNull();
		expect(windowProblem(b!, [a])).toBeNull();
	});

	it('says when there is no room left', () => {
		expect(newWindow(1, [{ start: '00:00', end: '23:30' }])).toBeNull();
	});

	it('rejects an end before the start, and overlaps', () => {
		expect(windowProblem({ start: '18:30', end: '05:00' }, [])).toMatch(/after the start/);
		expect(windowProblem({ start: '18:30', end: '18:30' }, [])).toMatch(/after the start/);
		expect(windowProblem({ start: '19:00', end: '20:00' }, [{ start: '18:30', end: '21:30' }])).toMatch(/overlaps/);
		expect(windowProblem({ start: '21:30', end: '23:00' }, [{ start: '18:30', end: '21:30' }])).toBeNull();
	});

	it('offers 24-hour times every half hour, plus an odd saved one', () => {
		const t = timeOptions(['18:45']);
		expect(t[0]).toBe('00:00');
		expect(t).toContain('18:30');
		expect(t).toContain('18:45');
		expect(t.every((x) => /^\d\d:\d\d$/.test(x))).toBe(true);
	});
});
