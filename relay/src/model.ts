// Calls to the Meta chat completions endpoint.
import { SPARK_MODEL } from '@kizuna/shared';
import { metaBase, type Env } from './env.ts';

export interface ToolCall { id: string; type: 'function'; function: { name: string; arguments: string } }
export interface Message {
	role: 'system' | 'user' | 'assistant' | 'tool';
	content: string | null;
	tool_call_id?: string;
	tool_calls?: ToolCall[];
}
export interface Usage { input_tokens: number; output_tokens: number }

export interface ChatRequest {
	messages: Message[];
	schema?: { name: string; schema: object };
	tools?: object[];
	reasoning_effort: string;
	max_tokens: number;
}

export type ChatResult =
	| { ok: true; message: Message; usage: Usage }
	| { ok: false; status: number; detail: string };

const TIMEOUT_MS = 55_000;

export async function chat(env: Env, req: ChatRequest): Promise<ChatResult> {
	const body: Record<string, unknown> = {
		model: SPARK_MODEL,
		messages: req.messages,
		reasoning_effort: req.reasoning_effort,
		max_tokens: req.max_tokens
	};
	if (req.schema) {
		body.response_format = {
			type: 'json_schema',
			json_schema: { name: req.schema.name, strict: true, schema: req.schema.schema }
		};
	}
	if (req.tools?.length) {
		body.tools = req.tools;
		body.tool_choice = 'auto';
	}
	let res: Response;
	try {
		res = await fetch(`${metaBase(env)}/chat/completions`, {
			method: 'POST',
			headers: {
				authorization: `Bearer ${env.MODEL_API_KEY ?? ''}`,
				'content-type': 'application/json',
				accept: 'application/json'
			},
			body: JSON.stringify(body),
			signal: AbortSignal.timeout(TIMEOUT_MS)
		});
	} catch (e) {
		return { ok: false, status: 0, detail: e instanceof Error && e.name === 'TimeoutError' ? 'timeout' : 'network' };
	}
	if (!res.ok) {
		// Status only: upstream error bodies can echo the prompt.
		await res.body?.cancel().catch(() => {});
		return { ok: false, status: res.status, detail: `upstream ${res.status}` };
	}
	let data: any;
	try {
		data = await res.json();
	} catch {
		return { ok: false, status: 502, detail: 'upstream sent invalid JSON' };
	}
	const message = data?.choices?.[0]?.message;
	if (!message || typeof message !== 'object') return { ok: false, status: 502, detail: 'no message' };
	const u = data.usage ?? {};
	return {
		ok: true,
		message: {
			role: 'assistant',
			content: typeof message.content === 'string' ? message.content : null,
			tool_calls: Array.isArray(message.tool_calls) ? message.tool_calls : undefined
		},
		usage: {
			input_tokens: Number(u.prompt_tokens ?? u.input_tokens ?? 0) || 0,
			output_tokens: Number(u.completion_tokens ?? u.output_tokens ?? 0) || 0
		}
	};
}

export function addUsage(a: Usage, b: Usage): Usage {
	return { input_tokens: a.input_tokens + b.input_tokens, output_tokens: a.output_tokens + b.output_tokens };
}

/** Parses model text as JSON, tolerating a ```json fence. */
export function parseModelJson(text: string | null): unknown {
	if (!text) throw new Error('empty');
	const t = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '').trim();
	return JSON.parse(t);
}
