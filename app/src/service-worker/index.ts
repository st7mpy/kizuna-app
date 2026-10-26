// Keeps the app shell on the phone so Kizuna opens offline. Never caches /api or /p.
import { immutable, assets, prerendered } from '$app/manifest';
import { version } from '$app/env';

const sw = self as unknown as ServiceWorkerGlobalScope;
const CACHE = `kizuna-${version}`;
const abs = (p: string) => '/' + p.replace(/^\//, '');
const SHELL = [
	...immutable.map((f) => abs(f.path)),
	...assets.map((f) => abs(f.path)),
	...prerendered.map((f) => abs(f.path)),
	'/200.html'
];
const NEVER = (path: string) => path.startsWith('/api/') || path === '/api' || path.startsWith('/p/') || path === '/p';

sw.addEventListener('install', (event) => {
	event.waitUntil(
		caches
			.open(CACHE)
			// All or nothing: if one file fails, install fails and the old worker and cache stay.
			.then((c) => c.addAll([...new Set(SHELL)]))
			.then(() => sw.skipWaiting())
	);
});

sw.addEventListener('activate', (event) => {
	event.waitUntil(
		caches
			.keys()
			.then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
			.then(() => sw.clients.claim())
	);
});

sw.addEventListener('fetch', (event) => {
	const req = event.request;
	if (req.method !== 'GET') return;
	const url = new URL(req.url);
	if (url.origin !== sw.location.origin || NEVER(url.pathname)) return;

	event.respondWith(
		(async () => {
			const cache = await caches.open(CACHE);
			// Built files never change: cache first.
			if (SHELL.includes(url.pathname) && req.mode !== 'navigate') {
				const hit = await cache.match(url.pathname);
				if (hit) return hit;
			}
			try {
				const res = await fetch(req);
				return res;
			} catch {
				// Offline: any page opens the SPA shell.
				if (req.mode === 'navigate') {
					return (
						(await cache.match(url.pathname)) ??
						(await cache.match('/200.html')) ??
						(await cache.match('/')) ??
						Response.error()
					);
				}
				return (await cache.match(url.pathname)) ?? Response.error();
			}
		})()
	);
});
