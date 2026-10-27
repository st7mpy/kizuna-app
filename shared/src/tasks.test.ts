import { describe, expect, it } from 'vitest';
import { buildTask, calendarLines, draftProblems, PLAN_TOOLS, TASK_LIMITS, taskFromMessages, WEEKEND_TOOLS } from './tasks.ts';
import { SCHEMAS } from './schemas.ts';
import type { TaskIO, TaskName } from './api.ts';

const inputs: { [T in TaskName]: TaskIO[T]['input'] } = {
	extract: {
		text: 'Mom has a knee appointment on Thursday, should call Jordan',
		today: '2026-10-26',
		weekday: 'Monday',
		knownPeople: [{ name: 'Mom', aliases: ['mum', 'mommy'], relation: 'parent' }]
	},
	weave: {
		today: '2026-10-26',
		notes: [
			{ id: 'n1', day: '2026-10-20', text: 'Maya wants to plan Dad\'s birthday' },
			{ id: 'n2', day: '2026-10-22', text: 'Jordan started his new job' }
		],
		people: [{ id: 'p1', name: 'Dad', aliases: ['dad', 'daddy'], relation: 'parent', circle: 'in' }]
	},
	draft: {
		personName: 'Jordan',
		relation: 'friend',
		reason: 'He started a new job on Monday.',
		context: ['new job at a studio'],
		myRecentLines: ['haha so true', 'see you this weekend then'],
		language: 'en',
		withTime: 'Sat 31 Oct, 10:00 to 11:00'
	},
	plan: {
		request: 'next weekend, not Sunday',
		now: '2026-10-26T09:00:00+05:30',
		timeZone: 'Asia/Kolkata',
		freeHours: [{ day: 6, start: '10:00', end: '13:00' }],
		busy: [],
		durationMinutes: 60
	},
	rank: {
		room: 'some',
		candidates: [
			{ id: 'c1', title: 'Jordan', reason: 'New job' },
			{ id: 'c2', title: 'Mom', reason: 'Appointment Thursday' }
		]
	},
	windows: {
		reply: 'Sunday afternoon works for me',
		now: '2026-10-30T18:10:00+05:30',
		timeZone: 'Asia/Kolkata'
	},
	weekend: {
		request: 'not Sunday, Dad has a game',
		now: '2026-10-30T18:10:00+05:30',
		timeZone: 'Asia/Kolkata',
		me: { name: 'Sam', windows: [], quietStart: '22:00', quietEnd: '08:00' },
		people: [
			{ id: 'p1', name: 'Mom', relation: 'parent', timeZone: 'America/Chicago', language: 'en', windows: [], quietStart: '22:00', quietEnd: '07:00' },
			{ id: 'p2', name: 'Jordan', relation: 'friend', timeZone: 'America/Toronto', language: 'en', windows: [], quietStart: '23:00', quietEnd: '08:00' }
		],
		occasions: [{ day: '2026-11-26', name: 'Thanksgiving', kind: 'festival', personIds: [], region: 'US' }],
		reasons: [{ personId: 'p2', text: 'Jordan started a new job.' }],
		minMinutes: 45
	}
};

describe('buildTask', () => {
	for (const task of Object.keys(inputs) as TaskName[]) {
		it(`${task}: marker, effort, size`, () => {
			const b = buildTask(task, inputs[task]);
			expect(b.messages[0].role).toBe('system');
			expect(b.messages[0].content.split('\n')[0]).toBe(`kizuna-task: ${task}`);
			expect(taskFromMessages(b.messages)).toBe(task);
			expect(b.max_tokens).toBeGreaterThan(100);
			expect(JSON.stringify(b).length).toBeLessThan(TASK_LIMITS[task] + 20_000);
			if (task === 'plan' || task === 'weekend') {
				expect(b.schema).toBeUndefined();
				expect(b.tools).toBe(task === 'plan' ? PLAN_TOOLS : WEEKEND_TOOLS);
			} else {
				expect(b.schema?.name).toBe(task);
				expect(b.schema?.schema).toBe(SCHEMAS[task]);
				expect(b.tools).toBeUndefined();
			}
		});
	}

	it('uses the agreed reasoning effort', () => {
		expect(buildTask('extract', inputs.extract).reasoning_effort).toBe('minimal');
		expect(buildTask('weave', inputs.weave).reasoning_effort).toBe('high');
		expect(buildTask('draft', inputs.draft).reasoning_effort).toBe('low');
		expect(buildTask('rank', inputs.rank).reasoning_effort).toBe('minimal');
		expect(buildTask('windows', inputs.windows).reasoning_effort).toBe('minimal');
		expect(buildTask('weekend', inputs.weekend).reasoning_effort).toBe('low');
	});

	it('extract asks for gift hints without prices', () => {
		const sys = buildTask('extract', inputs.extract).messages[0].content;
		expect(sys).toContain('Gift hints');
		expect(sys).toMatch(/Never include prices, money/);
	});

	it('windows gives the reply, the zone and an 8-day calendar from the local day', () => {
		const b = buildTask('windows', inputs.windows);
		expect(b.messages[0].content).toContain('evening = 17:00 to 20:00');
		const user = b.messages[1].content;
		expect(user).toContain('Sunday afternoon works for me');
		expect(user).toContain('Fri 2026-10-30 (today)');
		expect(user).toContain('Sat 2026-11-07 (+8)');
		expect(user).not.toContain('(+9)');
	});

	it('windows uses the local day, not the UTC day', () => {
		const user = buildTask('windows', { ...inputs.windows, now: '2026-10-31T00:30:00+05:30' }).messages[1].content;
		expect(user).toContain('Sat 2026-10-31 (today)');
	});

	it('weekend lists people, the weekend days and the request', () => {
		const user = buildTask('weekend', inputs.weekend).messages[1].content;
		expect(user).toContain('Friday');
		expect(user).toContain('The weekend: Sat 2026-10-31 and Sun 2026-11-01');
		expect(user).toContain('"not Sunday, Dad has a game"');
		expect(user).toContain('- id=p2 Jordan (friend), America/Toronto, writes en');
		expect(user).toContain('Shortest call: 45 minutes');
		// Notes and windows stay out of the prompt; the tools hand them over.
		expect(user).not.toContain('new job');
	});

	it('weekend tools are named as agreed', () => {
		expect(WEEKEND_TOOLS.map((t) => (t as any).function.name)).toEqual(['get_windows', 'get_occasions', 'get_local_time', 'get_reasons', 'finish']);
	});

	it('extract gives today, weekday, a calendar and known people', () => {
		const user = buildTask('extract', inputs.extract).messages[1].content;
		expect(user).toContain('Today is Monday, 2026-10-26');
		expect(user).toContain('Thu 2026-10-29 (+3)');
		expect(user).toContain('Mom (parent), also called: mum, mommy');
		expect(user).toContain('Mom has a knee appointment');
	});

	it('weave lists notes with ids and days, and people with ids', () => {
		const user = buildTask('weave', inputs.weave).messages[1].content;
		expect(user).toContain('[n2] 2026-10-22: Jordan started his new job');
		expect(user).toContain('id=p1 name=Dad');
	});

	it('draft includes tone lines and the offered time', () => {
		const user = buildTask('draft', inputs.draft).messages[1].content;
		expect(user).toContain('haha so true');
		expect(user).toContain('Offer this time: Sat 31 Oct');
	});

	it('plan includes the request and a 3-week calendar', () => {
		const user = buildTask('plan', inputs.plan).messages[1].content;
		expect(user).toContain('"next weekend, not Sunday"');
		expect(user).toContain('Mon 2026-11-16 (+21)');
	});
});

describe('taskFromMessages', () => {
	it('returns null without a marker', () => {
		expect(taskFromMessages([{ role: 'system', content: 'hello' }])).toBeNull();
		expect(taskFromMessages([{ role: 'user', content: 'kizuna-task: extract' }])).toBeNull();
		expect(taskFromMessages([{ role: 'system', content: 'kizuna-task: hack' }])).toBeNull();
		expect(taskFromMessages([{ role: 'system', content: 'kizuna-task: weekend\nx' }])).toBe('weekend');
	});
});

describe('calendarLines', () => {
	it('labels days around today', () => {
		expect(calendarLines('2026-10-26', 1, 1).split('\n')).toEqual(['Sun 2026-10-25 (yesterday)', 'Mon 2026-10-26 (today)', 'Tue 2026-10-27 (tomorrow)']);
	});
});

describe('draftProblems', () => {
	it('passes a kind line', () => expect(draftProblems('Kabir! How is the new job treating you?')).toEqual([]));
	it('flags guilt', () => expect(draftProblems('Long time!! how are you')).toContain('guilt'));
	it('flags urgency', () => expect(draftProblems('Call me ASAP')).toContain('urgency'));
	it('flags emoji spam', () => expect(draftProblems('hi 😀😀')).toContain('emoji'));
	it('allows one emoji', () => expect(draftProblems('hi 😀')).toEqual([]));
	it('flags long lines', () => expect(draftProblems('a'.repeat(201))).toContain('too_long'));
});
