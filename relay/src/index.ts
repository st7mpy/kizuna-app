// Kizuna relay: serves the app's static build and the API on one origin.
import type { Env } from './env.ts';
import { fail, json } from './http.ts';
import { handleSpark } from './spark.ts';
import { handleAsr } from './asr.ts';
import { handleTranscribe } from './transcribe.ts';
import { createInvite, getInvite, pickInvite } from './invite.ts';
import { handleIcal } from './ical.ts';
import { handlePage } from './page.ts';
import { createCircle, deleteMember, getCircle, putMember } from './circle.ts';
import { handleFamilyPage } from './family-page.ts';

export async function route(req: Request, env: Env): Promise<Response> {
	const url = new URL(req.url);
	const path = url.pathname;
	const m = req.method;

	if (path.startsWith('/p/')) {
		const match = /^\/p\/([^/]+)(\/.*)?$/.exec(path);
		return handlePage(req, env, match?.[1] ?? '', match?.[2] ?? '');
	}
	if (path.startsWith('/c/')) {
		const match = /^\/c\/([^/]*)\/?$/.exec(path);
		return handleFamilyPage(req, match?.[1] ?? '');
	}
	if (!path.startsWith('/api/')) return env.ASSETS.fetch(req);

	if (path === '/api/health') return m === 'GET' ? json({ ok: true, service: 'kizuna', time: new Date().toISOString() }) : fail('method_not_allowed');
	if (path === '/api/spark') return m === 'POST' ? handleSpark(req, env) : fail('method_not_allowed');
	if (path === '/api/asr') return m === 'GET' ? handleAsr(req, env) : fail('method_not_allowed');
	if (path === '/api/transcribe') return m === 'POST' ? handleTranscribe(req, env) : fail('method_not_allowed');
	if (path === '/api/ical') return m === 'POST' ? handleIcal(req) : fail('method_not_allowed');
	if (path === '/api/invite') return m === 'POST' ? createInvite(req, env) : fail('method_not_allowed');
	const inv = /^\/api\/invite\/([^/]+)(\/pick)?$/.exec(path);
	if (inv) {
		if (inv[2]) return m === 'POST' ? pickInvite(req, env, inv[1]) : fail('method_not_allowed');
		return m === 'GET' ? getInvite(env, inv[1]) : fail('method_not_allowed');
	}
	if (path === '/api/circle') return m === 'POST' ? createCircle(req, env) : fail('method_not_allowed');
	const circle = /^\/api\/circle\/([^/]+)(?:\/m\/([^/]+))?$/.exec(path);
	if (circle) {
		if (circle[2]) {
			if (m === 'PUT') return putMember(req, env, circle[1], circle[2]);
			if (m === 'DELETE') return deleteMember(req, env, circle[1], circle[2]);
			return fail('method_not_allowed');
		}
		return m === 'GET' ? getCircle(req, env, circle[1]) : fail('method_not_allowed');
	}
	return fail('not_found');
}

export default {
	async fetch(req: Request, env: Env): Promise<Response> {
		try {
			return await route(req, env);
		} catch (e) {
			// Name only: messages can quote request data.
			console.error(`relay error: ${e instanceof Error ? e.name : 'unknown'}`);
			return fail('server_error');
		}
	}
} satisfies ExportedHandler<Env>;
