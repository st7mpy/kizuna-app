import { describe, expect, it } from 'vitest';
import { buildTask, calendarLines, draftProblems, PLAN_TOOLS, TASK_LIMITS, taskFromMessages } from './tasks.ts';
import { SCHEMAS } from './schemas.ts';
import type { TaskIO, TaskName } from './api.ts';

const inputs: { [T in TaskName]: TaskIO[T]['input'] } = {
	extract: {
		text: 'Ma ka knee appointment Thursday ko hai, should call Kabir',
		today: '2026-10-26',
		weekday: 'Monday',
		knownPeople: [{ name: 'Mum', aliases: ['ma', 'mummy'], relation: 'parent' }]
	},
	weave: {
		today: '2026-10-26',
		notes: [
			{ id: 'n1', day: '2026-10-20', text: 'Riya wants to plan Papa ka birthday' },
			{ id: 'n2', day: '2026-10-22', text: 'Kabir ne naya job join kiya' }
		],
		people: [{ id: 'p1', name: 'Papa', aliases: ['papa', 'dad'], relation: 'parent', circle: 'in' }]
	},
	draft: {
		personName: 'Kabir',
		relation: 'friend',
		reason: 'He started a new job on Monday.',
		context: ['new job at a studio'],
		myRecentLines: ['haha sahi hai', 'chal milte hain weekend pe'],
		language: 'mixed',
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
			{ id: 'c1', title: 'Kabir', reason: 'New job' },
			{ id: 'c2', title: 'Mum', reason: 'Appointment Thursday' }
		]
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
			if (task === 'plan') {
				expect(b.schema).toBeUndefined();
				expect(b.tools).toBe(PLAN_TOOLS);
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
	});

	it('extract gives today, weekday, a calendar and known people', () => {
		const user = buildTask('extract', inputs.extract).messages[1].content;
		expect(user).toContain('Today is Monday, 2026-10-26');
		expect(user).toContain('Thu 2026-10-29 (+3)');
		expect(user).toContain('Mum (parent), also called: ma, mummy');
		expect(user).toContain('Ma ka knee appointment');
	});

	it('weave lists notes with ids and days, and people with ids', () => {
		const user = buildTask('weave', inputs.weave).messages[1].content;
		expect(user).toContain('[n2] 2026-10-22: Kabir ne naya job join kiya');
		expect(user).toContain('id=p1 name=Papa');
	});

	it('draft includes tone lines and the offered time', () => {
		const user = buildTask('draft', inputs.draft).messages[1].content;
		expect(user).toContain('haha sahi hai');
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
