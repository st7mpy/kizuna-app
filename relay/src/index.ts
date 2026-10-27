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

// The app's own pages (app/src/routes). Anything else that isn't a file gets the app shell
// with a 404 status, so the app shows its "not found" page and crawlers see a real 404.
const APP_PATH = /^\/(?:about|circle|circle\/[^/]+|map|settings|talk|threads)?\/?$/;

export function isAppPath(path: string): boolean {
	return APP_PATH.test(path);
}

/** Static files first; an unknown path gets the SPA shell (200 for app pages, 404 otherwise). */
export async function serveApp(req: Request, env: Env): Promise<Response> {
	const res = await env.ASSETS.fetch(req);
	if (res.status !== 404 || (req.method !== 'GET' && req.method !== 'HEAD')) return res;
	const path = new URL(req.url).pathname;
	// '/200' rather than '/200.html': the asset layer redirects .html to the bare path.
	// No request headers: a reload's If-None-Match would get a 304, which can't carry a 404 status.
	const shell = await env.ASSETS.fetch(new Request(new URL('/200', req.url)));
	if (!shell.ok) return res;
	const headers = new Headers(shell.headers);
	headers.set('cache-control', 'no-cache');
	return new Response(req.method === 'HEAD' ? null : shell.body, { status: isAppPath(path) ? 200 : 404, headers });
}

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
	if (!path.startsWith('/api/')) return serveApp(req, env);

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
