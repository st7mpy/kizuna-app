import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { completion, get, makeEnv, post } from './helpers.ts';

// Prompts belong to tasks.ts; these tests only care about the relay around them.
const buildTask = vi.fn();
vi.mock('@kizuna/shared', async (importOriginal) => {
	const real = await importOriginal<typeof import('@kizuna/shared')>();
	return {
		...real,
		buildTask: (...args: unknown[]) => buildTask(...args),
		SCHEMAS: { ...real.SCHEMAS, rank: RANK_SCHEMA }
	};
});

const RANK_SCHEMA = {
	type: 'object',
	additionalProperties: false,
	required: ['order'],
	properties: { order: { type: 'array', items: { type: 'string' } } }
};

const { route } = await import('../src/index.ts');
const { resetAllLimits } = await import('../src/ratelimit.ts');
const { TASK_LIMITS } = await import('@kizuna/shared');

const rankInput = { room: 'some', candidates: [{ id: 'a', title: 'Kabir', reason: 'new job' }] };
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
	resetAllLimits();
	buildTask.mockReset();
	buildTask.mockImplementation((task: string) => ({
		messages: [
			{ role: 'system', content: `task ${task}` },
			{ role: 'user', content: 'input' }
		],
		reasoning_effort: 'minimal',
		max_tokens: 400
	}));
	fetchMock = vi.fn();
	vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe('router basics', () => {
	it('answers health with security headers', async () => {
		const res = await route(get('/api/health'), makeEnv());
		expect(res.status).toBe(200);
		expect(((await res.json()) as any).ok).toBe(true);
		expect(res.headers.get('x-content-type-options')).toBe('nosniff');
		expect(res.headers.get('content-security-policy')).toContain("default-src 'none'");
		expect(res.headers.get('cache-control')).toBe('no-store');
	});

	it('404s unknown api paths and serves the app for the rest', async () => {
		expect((await route(get('/api/nope'), makeEnv())).status).toBe(404);
		const app = await route(get('/today'), makeEnv());
		expect(await app.text()).toBe('app shell');
	});

	it('rejects wrong methods', async () => {
		expect((await route(get('/api/spark'), makeEnv())).status).toBe(405);
	});
});

describe('POST /api/spark', () => {
	it('allows only known tasks', async () => {
		const res = await route(post('/api/spark', { task: 'chat', input: { prompt: 'hi' } }), makeEnv());
		expect(res.status).toBe(400);
		expect(await res.json()).toMatchObject({ ok: false, error: 'bad_request' });
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('rejects bad JSON and non-object input', async () => {
		expect((await route(post('/api/spark', '{nope'), makeEnv())).status).toBe(400);
		expect((await route(post('/api/spark', { task: 'rank', input: 'x' }), makeEnv())).status).toBe(400);
	});

	it('caps body size per task', async () => {
		const big = 'x'.repeat(TASK_LIMITS.rank + 10);
		const res = await route(post('/api/spark', { task: 'rank', input: { room: 'low', candidates: [{ id: big }] } }), makeEnv());
		expect(res.status).toBe(413);
		expect(await res.json()).toMatchObject({ ok: false, error: 'too_large' });
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('calls chat completions with strict json_schema and returns the output', async () => {
		fetchMock.mockResolvedValueOnce(completion({ content: JSON.stringify({ order: ['a'] }) }));
		const res = await route(post('/api/spark', { task: 'rank', input: rankInput }), makeEnv());
		expect(await res.json()).toEqual({ ok: true, output: { order: ['a'] }, usage: { input_tokens: 10, output_tokens: 5 } });
		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toBe('https://meta.test/v1/chat/completions');
		expect(init.headers.authorization).toBe('Bearer test-key');
		const body = JSON.parse(init.body);
		expect(body.model).toBe('muse-spark-1.3');
		expect(body.reasoning_effort).toBe('minimal');
		expect(body.max_tokens).toBe(400);
		expect(body.response_format).toEqual({ type: 'json_schema', json_schema: { name: 'rank', strict: true, schema: RANK_SCHEMA } });
	});

	it('prefers the schema from buildTask when given', async () => {
		const schema = { type: 'object', additionalProperties: false, required: ['line', 'language'], properties: { line: { type: 'string' }, language: { type: 'string' } } };
		buildTask.mockReturnValueOnce({ messages: [{ role: 'user', content: 'x' }], schema: { name: 'draft', schema }, reasoning_effort: 'low', max_tokens: 400 });
		fetchMock.mockResolvedValueOnce(completion({ content: '{"line":"Hey","language":"en"}' }));
		const res = await route(post('/api/spark', { task: 'draft', input: { personName: 'Kabir' } }), makeEnv());
		expect(((await res.json()) as any).output).toEqual({ line: 'Hey', language: 'en' });
	});

	it('retries once when the output fails the schema, then succeeds', async () => {
		fetchMock
			.mockResolvedValueOnce(completion({ content: JSON.stringify({ order: 'a' }) }))
			.mockResolvedValueOnce(completion({ content: JSON.stringify({ order: ['a'] }) }));
		const res = await route(post('/api/spark', { task: 'rank', input: rankInput }), makeEnv());
		const out = await res.json();
		expect(out).toMatchObject({ ok: true, output: { order: ['a'] }, usage: { input_tokens: 20, output_tokens: 10 } });
		expect(fetchMock).toHaveBeenCalledTimes(2);
		const second = JSON.parse(fetchMock.mock.calls[1][1].body);
		expect(second.messages.at(-1).content).toContain('did not match the schema');
	});

	it('retries once on invalid JSON, then gives invalid_output', async () => {
		fetchMock.mockImplementation(async () => completion({ content: 'not json' }));
		const res = await route(post('/api/spark', { task: 'rank', input: rankInput }), makeEnv());
		expect(res.status).toBe(502);
		expect(await res.json()).toEqual({ ok: false, error: 'invalid_output' });
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it('maps upstream failures to model_error without retrying', async () => {
		fetchMock.mockResolvedValueOnce(new Response('nope', { status: 500 }));
		const res = await route(post('/api/spark', { task: 'rank', input: rankInput }), makeEnv());
		expect(await res.json()).toMatchObject({ ok: false, error: 'model_error' });
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it('turns a buildTask throw into bad_request', async () => {
		buildTask.mockImplementationOnce(() => {
			throw new Error('bad input');
		});
		const res = await route(post('/api/spark', { task: 'rank', input: {} }), makeEnv());
		expect(res.status).toBe(400);
	});

	it('rate limits a device, and a busy IP across devices', async () => {
		fetchMock.mockImplementation(async () => completion({ content: '{"order":[]}' }));
		const env = makeEnv();
		let limited = 0;
		for (let i = 0; i < 25; i++) {
			const res = await route(post('/api/spark', { task: 'rank', input: rankInput }), env);
			if (res.status === 429) limited++;
		}
		expect(limited).toBe(5); // burst of 20
		const res = await route(post('/api/spark', { task: 'rank', input: rankInput }), env);
		expect(res.headers.get('retry-after')).toBe('30');
		// Another device on another IP is unaffected.
		const other = await route(post('/api/spark', { task: 'rank', input: rankInput }, { 'cf-connecting-ip': '198.51.100.1', 'x-kizuna-device': 'd2' }), env);
		expect(other.status).toBe(200);
		// Rotating device ids on one IP runs into the IP limit (4x).
		let ipLimited = false;
		for (let i = 0; i < 70 && !ipLimited; i++) {
			const r = await route(post('/api/spark', { task: 'rank', input: rankInput }, { 'x-kizuna-device': `rot${i}` }), env);
			ipLimited = r.status === 429;
		}
		expect(ipLimited).toBe(true);
	});
});
