// Runs extract over eval/fixtures/hinglish-30.json and scores it.
//   META_BASE_URL  default http://localhost:8788/v1 (the local fake); the real API is https://api.meta.ai/v1
//   MODEL_API_KEY  optional bearer token
//   EVAL_ONLY      optional comma-separated case ids, e.g. h01,h07
// Usage: npm run eval   (node --experimental-strip-types run.ts)
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SPARK_MODEL } from '../shared/src/api.ts';
import type { ExtractInput, ExtractOutput } from '../shared/src/api.ts';
import { buildTask } from '../shared/src/tasks.ts';
import { formatTable, guardEvents, scoreCase, summarise } from './score.ts';
import type { Case, CaseScore } from './score.ts';

interface Fixture { today: string; weekday: string; knownPeople: ExtractInput['knownPeople']; cases: Case[] }

const here = dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.META_BASE_URL ?? 'http://localhost:8788/v1').replace(/\/$/, '');
const KEY = process.env.MODEL_API_KEY;
const CONCURRENCY = 4;

export async function extractOnce(input: ExtractInput): Promise<{ output: ExtractOutput; ms: number; usage?: unknown }> {
	const built = buildTask('extract', input);
	const started = Date.now();
	const res = await fetch(`${BASE}/chat/completions`, {
		method: 'POST',
		headers: { 'content-type': 'application/json', ...(KEY ? { authorization: `Bearer ${KEY}` } : {}) },
		body: JSON.stringify({
			model: SPARK_MODEL,
			messages: built.messages,
			response_format: { type: 'json_schema', json_schema: { name: built.schema!.name, strict: true, schema: built.schema!.schema } },
			reasoning_effort: built.reasoning_effort,
			max_tokens: built.max_tokens
		})
	});
	if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
	const body = (await res.json()) as { choices?: { message?: { content?: string } }[]; usage?: unknown };
	const content = body.choices?.[0]?.message?.content;
	if (!content) throw new Error('empty response');
	return { output: JSON.parse(content) as ExtractOutput, ms: Date.now() - started, usage: body.usage };
}

async function main() {
	const fixture = JSON.parse(await readFile(join(here, 'fixtures', 'hinglish-30.json'), 'utf8')) as Fixture;
	const only = process.env.EVAL_ONLY?.split(',').map((s) => s.trim());
	const cases = only ? fixture.cases.filter((c) => only.includes(c.id)) : fixture.cases;
	console.log(`Kizuna extract eval: ${cases.length} cases against ${BASE}\n`);

	const results: { id: string; text: string; output: ExtractOutput | null; guarded: unknown; error: string | null; ms: number | null; score: CaseScore }[] = [];
	let next = 0;
	async function worker() {
		while (next < cases.length) {
			const c = cases[next++];
			const input: ExtractInput = { text: c.text, today: fixture.today, weekday: fixture.weekday, knownPeople: fixture.knownPeople };
			try {
				const { output, ms } = await extractOnce(input);
				results.push({ id: c.id, text: c.text, output, guarded: guardEvents(output, fixture.today), error: null, ms, score: scoreCase(c, output, fixture.today) });
			} catch (err) {
				const error = err instanceof Error ? err.message : String(err);
				results.push({ id: c.id, text: c.text, output: null, guarded: null, error, ms: null, score: scoreCase(c, null, fixture.today) });
			}
		}
	}
	await Promise.all(Array.from({ length: CONCURRENCY }, worker));
	results.sort((a, b) => a.id.localeCompare(b.id));

	const failed = results.filter((r) => r.error).length;
	const scores = results.map((r) => r.score);
	const summary = summarise(scores, failed);
	console.log(formatTable(scores, summary));
	for (const r of results.filter((r) => r.error)) console.log(`\n${r.id} failed: ${r.error}`);

	const outDir = join(here, 'results');
	await mkdir(outDir, { recursive: true });
	const stamp = new Date().toISOString().replace(/[:.]/g, '-');
	const file = join(outDir, `${stamp}.json`);
	await writeFile(file, JSON.stringify({ baseUrl: BASE, model: SPARK_MODEL, today: fixture.today, summary, results }, null, 2));
	console.log(`\nSaved ${file}`);
	if (failed === cases.length) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
	main().catch((err) => {
		console.error(err);
		process.exitCode = 1;
	});
}
