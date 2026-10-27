import { describe, expect, it } from 'vitest';
import { escapeHtml, readCapped } from '../src/http.ts';
import { isAppPath, serveApp } from '../src/index.ts';
import type { Env } from '../src/env.ts';

describe('escapeHtml', () => {
	it('escapes the five characters', () => {
		expect(escapeHtml(`<a href="x" onclick='y'>&</a>`)).toBe('&lt;a href=&quot;x&quot; onclick=&#39;y&#39;&gt;&amp;&lt;/a&gt;');
	});
	it('handles non-strings', () => {
		expect(escapeHtml(null)).toBe('');
		expect(escapeHtml(42)).toBe('42');
	});
});

describe('readCapped', () => {
	it('stops reading past the cap', async () => {
		const body = new Response('x'.repeat(100)).body;
		expect(await readCapped(body, 50)).toBeNull();
		expect((await readCapped(new Response('hello').body, 50))!.byteLength).toBe(5);
	});
});

describe('app shell for unknown paths', () => {
	const assets = {
		fetch: async (r: Request) => {
			const p = new URL(r.url).pathname;
			if (p === '/200') return new Response('<!doctype html>shell', { headers: { 'content-type': 'text/html' } });
			if (p === '/favicon.svg') return new Response('<svg/>', { headers: { 'content-type': 'image/svg+xml' } });
			return new Response('nope', { status: 404 });
		}
	} as unknown as Fetcher;
	const env = { ASSETS: assets } as unknown as Env;
	const get = (p: string) => serveApp(new Request(`https://k.test${p}`), env);

	it('serves app pages, deep links included, with 200', async () => {
		for (const p of ['/', '/talk', '/circle', '/circle/abc123', '/map/', '/settings', '/threads', '/about']) {
			const r = await get(p);
			expect([p, r.status]).toEqual([p, 200]);
			expect(await r.text()).toBe('<!doctype html>shell');
		}
	});

	it('answers 404 (with the app shell, so the page still says so) for anything else', async () => {
		for (const p of ['/nope', '/circle/a/b', '/wp-login.php']) {
			const r = await get(p);
			expect([p, r.status]).toEqual([p, 404]);
			expect(await r.text()).toBe('<!doctype html>shell');
		}
		expect((await get('/favicon.svg')).status).toBe(200);
		expect(isAppPath('/circle/x')).toBe(true);
	});

	it('serves the shell on a reload that sends If-None-Match', async () => {
		const seen: (string | null)[] = [];
		const env304 = {
			ASSETS: {
				fetch: async (r: Request) => {
					seen.push(r.headers.get('if-none-match'));
					if (new URL(r.url).pathname !== '/200') return new Response('nope', { status: 404 });
					return r.headers.get('if-none-match') ? new Response(null, { status: 304 }) : new Response('shell');
				}
			}
		} as unknown as Env;
		const r = await serveApp(new Request('https://k.test/circle/abc', { headers: { 'if-none-match': '"x"' } }), env304);
		expect(r.status).toBe(200);
		expect(await r.text()).toBe('shell');
	});
});
