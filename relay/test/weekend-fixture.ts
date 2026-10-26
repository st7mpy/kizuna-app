// Friday 30 Oct 2026, 18:10 in Delhi: Mum, Papa, Riya in India, Kabir in Toronto, Meera in London.
import type { WeekendInput } from '@kizuna/shared';

const IST = 'Asia/Kolkata';
const w = (start: string, end: string) => ({ start, end });

// Friday 30 Oct 2026, 18:10 in Delhi. The weekend is Sat 31 Oct and Sun 1 Nov.
export const sampleWeekend: WeekendInput = {
	request: '',
	now: '2026-10-30T18:10:00+05:30',
	timeZone: IST,
	me: {
		name: 'Aarav',
		windows: [w('2026-10-31T17:00:00+05:30', '2026-10-31T23:00:00+05:30'), w('2026-11-01T09:00:00+05:30', '2026-11-01T13:00:00+05:30')],
		quietStart: '22:00',
		quietEnd: '08:00'
	},
	people: [
		{ id: 'mum', name: 'Mum', relation: 'parent', timeZone: IST, language: 'mixed', quietStart: '22:00', quietEnd: '07:00', windows: [w('2026-10-31T17:00:00+05:30', '2026-10-31T21:00:00+05:30'), w('2026-11-01T09:00:00+05:30', '2026-11-01T12:00:00+05:30')] },
		{ id: 'papa', name: 'Papa', relation: 'parent', timeZone: IST, language: 'hi', quietStart: '22:00', quietEnd: '07:00', windows: [w('2026-11-01T09:00:00+05:30', '2026-11-01T12:00:00+05:30')] },
		{ id: 'riya', name: 'Riya', relation: 'sibling', timeZone: IST, language: 'mixed', quietStart: '23:00', quietEnd: '08:00', windows: [w('2026-11-01T10:00:00+05:30', '2026-11-01T13:00:00+05:30')] },
		// Toronto: Sat 10:00 to 13:00 there is Sat 19:30 to 22:30 in Delhi. Also free late Saturday night there.
		{ id: 'kabir', name: 'Kabir', relation: 'friend', timeZone: 'America/Toronto', language: 'en', quietStart: '23:00', quietEnd: '08:00', windows: [w('2026-10-31T10:00:00-04:00', '2026-10-31T13:00:00-04:00'), w('2026-10-31T22:00:00-04:00', '2026-11-01T01:30:00-04:00')] },
		{ id: 'meera', name: 'Meera', relation: 'friend', timeZone: 'Europe/London', language: 'en', quietStart: '22:00', quietEnd: '08:00', windows: [] }
	],
	occasions: [{ day: '2026-11-01', name: 'Diwali', kind: 'festival', personIds: [], region: 'IN' }],
	reasons: [{ personId: 'kabir', text: 'Kabir started a new job.' }],
	minMinutes: 45
};
