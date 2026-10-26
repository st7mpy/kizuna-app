import { describe, expect, it } from 'vitest';
import { guardDate, resolveRelDay, shiftDay, weekdayOfDay } from './dates.ts';

// 2026-10-26 is a Monday.
const MON = '2026-10-26';
const THU = '2026-10-29';
const SAT = '2026-10-31';
const SUN = '2026-11-01';

const g = (model: string | null, text: string | null, today = MON) => guardDate(model, text, today);

describe('helpers', () => {
	it('knows weekdays and adds days across months', () => {
		expect(weekdayOfDay(MON)).toBe(1);
		expect(shiftDay(MON, 7)).toBe('2026-11-02');
		expect(shiftDay('2026-03-01', -1)).toBe('2026-02-28');
	});
});

describe('no date words', () => {
	it('keeps the model day as a guess', () => expect(g('2026-10-30', null)).toEqual({ day: '2026-10-30', confidence: 'guess' }));
	it('returns none without a model day', () => expect(g(null, null)).toEqual({ day: null, confidence: 'none' }));
	it('treats empty text like no text', () => expect(g(null, '  ')).toEqual({ day: null, confidence: 'none' }));
	it('ignores an invalid model day', () => expect(g('2026-02-30', null)).toEqual({ day: null, confidence: 'none' }));
	it('treats unknown words as no date words', () => expect(g('2026-11-05', 'soon')).toEqual({ day: '2026-11-05', confidence: 'guess' }));
	it('"aaj kal" means these days, not a date', () => expect(g(null, 'aaj kal')).toEqual({ day: null, confidence: 'none' }));
	it('time-of-day words alone are not dates', () => expect(g('2026-10-27', 'shaam ko')).toEqual({ day: '2026-10-27', confidence: 'guess' }));
});

describe('today / tomorrow / yesterday', () => {
	it('today', () => expect(g('2026-10-27', 'today')).toEqual({ day: MON, confidence: 'sure' }));
	it('aaj', () => expect(g(null, 'aaj shaam')).toEqual({ day: MON, confidence: 'sure' }));
	it('tonight', () => expect(g(null, 'tonight')).toEqual({ day: MON, confidence: 'sure' }));
	it('tomorrow', () => expect(g('2026-10-29', 'tomorrow morning')).toEqual({ day: '2026-10-27', confidence: 'sure' }));
	it('yesterday', () => expect(g(null, 'yesterday')).toEqual({ day: '2026-10-25', confidence: 'sure' }));
	it('day after tomorrow', () => expect(g(null, 'day after tomorrow')).toEqual({ day: '2026-10-28', confidence: 'sure' }));
	it('day before yesterday', () => expect(g(null, 'day before yesterday')).toEqual({ day: '2026-10-24', confidence: 'sure' }));
});

describe('kal and parso point both ways', () => {
	it('kal with no model day is tomorrow, a guess', () => expect(g(null, 'kal')).toEqual({ day: '2026-10-27', confidence: 'guess' }));
	it('kal with model tomorrow is sure', () => expect(g('2026-10-27', 'kal')).toEqual({ day: '2026-10-27', confidence: 'sure' }));
	it('kal with model yesterday keeps yesterday', () => expect(g('2026-10-25', 'kal raat')).toEqual({ day: '2026-10-25', confidence: 'sure' }));
	it('kal with an unrelated model day becomes tomorrow', () => expect(g('2026-11-09', 'kal subah')).toEqual({ day: '2026-10-27', confidence: 'guess' }));
	it('parso is the day after tomorrow', () => expect(g(null, 'parso')).toEqual({ day: '2026-10-28', confidence: 'guess' }));
	it('parso can be two days ago when the model says so', () => expect(g('2026-10-24', 'parso')).toEqual({ day: '2026-10-24', confidence: 'sure' }));
});

describe('weekdays', () => {
	it('fixes a wrong Thursday', () => expect(g('2026-10-30', 'Thursday')).toEqual({ day: THU, confidence: 'sure' }));
	it('"Thursday ko" with no model day', () => expect(g(null, 'Thursday ko')).toEqual({ day: THU, confidence: 'sure' }));
	it('keeps a correct Thursday', () => expect(g(THU, 'thursday')).toEqual({ day: THU, confidence: 'sure' }));
	it('Hindi weekday names', () => {
		expect(g(null, 'somvar').day).toBe(MON);
		expect(g(null, 'mangalvar ko').day).toBe('2026-10-27');
		expect(g(null, 'budhvar').day).toBe('2026-10-28');
		expect(g(null, 'guruvar').day).toBe(THU);
		expect(g(null, 'shukravar ko').day).toBe('2026-10-30');
		expect(g(null, 'shanivar').day).toBe(SAT);
		expect(g(null, 'ravivar').day).toBe(SUN);
		expect(g(null, 'itvaar ko').day).toBe(SUN);
	});
	it('short English names', () => expect(g(null, 'fri evening').day).toBe('2026-10-30'));
	it('"sun" alone is not Sunday', () => expect(g(null, 'sun')).toEqual({ day: null, confidence: 'none' }));
	it('accepts a recent past weekday chosen by the model', () => expect(g('2026-10-22', 'Thursday ko')).toEqual({ day: '2026-10-22', confidence: 'sure' }));
	it('a weekday far from today is moved to the next one', () => expect(g('2026-12-03', 'Thursday')).toEqual({ day: THU, confidence: 'sure' }));
	it('same weekday as today means today', () => expect(g(null, 'Monday')).toEqual({ day: MON, confidence: 'sure' }));
	it('last Friday', () => expect(g(null, 'last Friday')).toEqual({ day: '2026-10-23', confidence: 'sure' }));
	it('pichhle Monday is a week ago', () => expect(g(null, 'pichhle Monday')).toEqual({ day: '2026-10-19', confidence: 'sure' }));
	it('agle hafte Thursday ko', () => expect(g('2026-10-29', 'agle hafte Thursday ko')).toEqual({ day: '2026-11-05', confidence: 'guess' }));
	it('agle hafte Thursday, model right', () => expect(g('2026-11-05', 'agle hafte guruvar')).toEqual({ day: '2026-11-05', confidence: 'sure' }));
	it('next Thursday accepts either reading', () => {
		expect(g(THU, 'next Thursday')).toEqual({ day: THU, confidence: 'guess' });
		expect(g('2026-11-05', 'next Thursday')).toEqual({ day: '2026-11-05', confidence: 'guess' });
	});
	it('next Thursday with a wrong model day', () => expect(g('2026-11-06', 'next thursday')).toEqual({ day: '2026-11-05', confidence: 'guess' }));
	it('this week Friday', () => expect(g(null, 'is hafte Friday')).toEqual({ day: '2026-10-30', confidence: 'sure' }));
	it('weekday from a Saturday rolls into next week', () => expect(g(null, 'Wednesday', SAT)).toEqual({ day: '2026-11-04', confidence: 'sure' }));
});

describe('weeks and weekends', () => {
	it('this weekend from Monday is Saturday', () => expect(g(null, 'this weekend')).toEqual({ day: SAT, confidence: 'guess' }));
	it('this weekend keeps a model Sunday', () => expect(g(SUN, 'is weekend')).toEqual({ day: SUN, confidence: 'guess' }));
	it('this weekend said on Sunday is today', () => expect(g(null, 'weekend pe', SUN)).toEqual({ day: SUN, confidence: 'guess' }));
	it('this weekend said on Saturday', () => expect(g('2026-10-20', 'this weekend', SAT)).toEqual({ day: SAT, confidence: 'guess' }));
	it('next weekend', () => expect(g(null, 'next weekend')).toEqual({ day: '2026-11-07', confidence: 'guess' }));
	it('next week with model inside it', () => expect(g('2026-11-04', 'next week')).toEqual({ day: '2026-11-04', confidence: 'guess' }));
	it('agle hafte with model outside it goes to Monday', () => expect(g('2026-10-28', 'agle hafte')).toEqual({ day: '2026-11-02', confidence: 'guess' }));
	it('this week without a model day is unknown', () => expect(g(null, 'this week')).toEqual({ day: null, confidence: 'none' }));
	it('next month keeps a model day inside it', () => expect(g('2026-11-20', 'next month')).toEqual({ day: '2026-11-20', confidence: 'guess' }));
	it('next month drops a model day outside it', () => expect(g('2026-10-28', 'agle mahine')).toEqual({ day: null, confidence: 'none' }));
	it('in 3 days', () => expect(g(null, 'in 3 days')).toEqual({ day: '2026-10-29', confidence: 'sure' }));
	it('teen din baad', () => expect(g(null, 'teen din baad')).toEqual({ day: '2026-10-29', confidence: 'sure' }));
	it('do hafte mein', () => expect(g(null, 'do hafte mein')).toEqual({ day: '2026-11-09', confidence: 'guess' }));
});

describe('explicit dates', () => {
	it('12 Nov', () => expect(g('2026-11-13', '12 Nov')).toEqual({ day: '2026-11-12', confidence: 'sure' }));
	it('Nov 12th', () => expect(g(null, 'on Nov 12th')).toEqual({ day: '2026-11-12', confidence: 'sure' }));
	it('12th November 2027', () => expect(g(null, '12th November 2027')).toEqual({ day: '2027-11-12', confidence: 'sure' }));
	it('12/11 is day first', () => expect(g(null, '12/11')).toEqual({ day: '2026-11-12', confidence: 'sure' }));
	it('11/25 flips when the second part cannot be a month', () => expect(g(null, '11/25')).toEqual({ day: '2026-11-25', confidence: 'sure' }));
	it('2 Jan picks the coming year', () => expect(g(null, '2 Jan')).toEqual({ day: '2027-01-02', confidence: 'sure' }));
	it('20 Oct stays in the recent past', () => expect(g(null, '20 oct')).toEqual({ day: '2026-10-20', confidence: 'sure' }));
	it('the 12th alone', () => expect(g(null, 'the 12th')).toEqual({ day: '2026-11-12', confidence: 'guess' }));
	it('the 28th alone is this month', () => expect(g(null, '28th')).toEqual({ day: '2026-10-28', confidence: 'guess' }));
	it('12 tarikh with matching model', () => expect(g('2026-11-12', '12 tarikh ko')).toEqual({ day: '2026-11-12', confidence: 'sure' }));
	it('explicit date wins over a weekday', () => expect(g(null, 'Thursday 12 Nov')).toEqual({ day: '2026-11-12', confidence: 'sure' }));
	it('31 Feb is not a date', () => expect(g('2026-11-01', '31 feb')).toEqual({ day: '2026-11-01', confidence: 'guess' }));
});

describe('resolveRelDay', () => {
	it('turns rel:N into a day', () => {
		expect(resolveRelDay('rel:2', '2026-10-26')).toBe('2026-10-28');
		expect(resolveRelDay('rel:-14', '2026-10-26')).toBe('2026-10-12');
		expect(resolveRelDay(null, '2026-10-26')).toBeNull();
		expect(resolveRelDay('2026-11-01', '2026-10-26')).toBe('2026-11-01');
	});
});
