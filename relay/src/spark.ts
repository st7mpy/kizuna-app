// POST /api/spark: runs one named task. The app never sends prompts; the relay builds them.
import { buildTask, SCHEMAS, TASK_LIMITS, type SchemaTask, type TaskName, type PlanInput, type WindowsOutput } from '@kizuna/shared';
import type { Env } from './env.ts';
import { fail, json, readBody } from './http.ts';
import { edgeAllow, limits } from './ratelimit.ts';
import { overBudget, sparkUsd, spend, withinBudget } from './budget.ts';
import { addUsage, chat, parseModelJson, type Message, type Usage } from './model.ts';
import { checkWindowsInput, guardWindows, schemaErrors } from './validate.ts';
import { runPlan, PlanInputError } from './plan.ts';
import { runWeekend, WeekendInputError } from './weekend.ts';

export const TASKS: readonly TaskName[] = ['extract', 'weave', 'draft', 'plan', 'rank', 'windows', 'weekend'];
const MAX_BODY = Math.max(...Object.values(TASK_LIMITS)) + 1024;

export async function handleSpark(req: Request, env: Env): Promise<Response> {
	if (!limits.spark.allow(req) || !(await edgeAllow(env.RL_SPARK, req))) return fail('rate_limited');
	const bytes = await readBody(req, MAX_BODY);
	if (!bytes) return fail('too_large');
	let body: any;
	try {
		body = JSON.parse(new TextDecoder().decode(bytes));
	} catch {
		return fail('bad_request', 'body is not JSON');
	}
	const task = body?.task as TaskName;
	if (typeof task !== 'string' || !TASKS.includes(task)) return fail('bad_request', 'unknown task');
	if (bytes.byteLength > TASK_LIMITS[task]) return fail('too_large');
	let input = body.input;
	if (!input || typeof input !== 'object' || Array.isArray(input)) return fail('bad_request', 'input must be an object');
	if (task === 'windows') {
		const checked = checkWindowsInput(input);
		if (typeof checked === 'string') return fail('bad_request', checked);
		input = checked;
	}

	const weave = task === 'weave';
	if (weave && (!limits.weave.allow(req) || !(await edgeAllow(env.RL_WEAVE, req)))) return fail('rate_limited');
	if (!(await withinBudget(env, weave))) return overBudget();

	const charge = (usage: Usage) => spend(env, sparkUsd(usage), weave);
	if (task === 'plan') {
		try {
			const { output, usage } = await runPlan(env, input as PlanInput);
			await charge(usage);
			return json({ ok: true, output, usage });
		} catch (e) {
			if (e instanceof PlanInputError) return fail('bad_request', e.message);
			throw e;
		}
	}
	if (task === 'weekend') {
		try {
			const { output, usage } = await runWeekend(env, input);
			await charge(usage);
			return json({ ok: true, output, usage });
		} catch (e) {
			if (e instanceof WeekendInputError) return fail('bad_request', e.message);
			throw e;
		}
	}
	const post = task === 'windows' ? (out: unknown) => guardWindows(out as WindowsOutput, input) : undefined;
	const { response, usage } = await runStructured(env, task, input, post);
	await charge(usage);
	return response;
}

async function runStructured(
	env: Env,
	task: SchemaTask,
	input: any,
	post?: (output: unknown) => unknown
): Promise<{ response: Response; usage: Usage }> {
	let usage: Usage = { input_tokens: 0, output_tokens: 0 };
	const done = (response: Response) => ({ response, usage });
	let built;
	try {
		built = buildTask(task, input);
	} catch {
		return done(fail('bad_request', 'input does not fit the task'));
	}
	const schema = built.schema ?? { name: task, schema: SCHEMAS[task] };
	const messages: Message[] = built.messages.map((m) => ({ ...m }));
	let problem = '';
	for (let attempt = 0; attempt < 2; attempt++) {
		const res = await chat(env, { messages, schema, reasoning_effort: built.reasoning_effort, max_tokens: built.max_tokens });
		if (!res.ok) {
			console.error(`spark ${task}: ${res.detail}`);
			return done(fail('model_error', res.status === 429 ? 'busy' : undefined));
		}
		usage = addUsage(usage, res.usage);
		let output: unknown;
		try {
			output = parseModelJson(res.message.content);
		} catch {
			problem = 'The reply was not valid JSON.';
			messages.push({ role: 'assistant', content: res.message.content ?? '' });
			messages.push({ role: 'user', content: `${problem} Reply again with only JSON that matches the schema.` });
			continue;
		}
		const errors = schemaErrors(schema.schema, output);
		if (!errors) return done(json({ ok: true, output: post ? post(output) : output, usage }));
		problem = `The reply did not match the schema: ${errors}.`;
		messages.push({ role: 'assistant', content: res.message.content ?? '' });
		messages.push({ role: 'user', content: `${problem} Reply again with only JSON that matches the schema.` });
	}
	console.error(`spark ${task}: invalid output after retry`);
	return done(fail('invalid_output'));
}
