import { describe, expect, it } from 'vitest';
import { newCircleKey, openEntry, randomId, sealEntry, type CircleEntry } from '@kizuna/shared';
import { route } from '../src/index.ts';
import { SEAL_JS, TIME_JS, renderFamilyPage } from '../src/family-page.ts';
import { get, makeEnv } from './helpers.ts';

// The page's inline sealing code, run as the browser would run it.
const page = new Function(`${SEAL_JS}; return { sealEntry, openEntry, keyOk, randomId };`)() as {
	sealEntry: typeof sealEntry;
	openEntry: typeof openEntry;
	keyOk: (k: string) => Promise<boolean>;
	randomId: (n: number) => string;
};

const entry: CircleEntry = {
	v: 1,
	name: 'Nani',
	tz: 'Asia/Kolkata',
	status: null,
	statusUntil: null,
	windows: [{ start: '2026-11-01T09:00:00+05:30', end: '2026-11-01T12:00:00+05:30' }],
	via: 'page',
	updatedAt: '2026-10-30T19:00:00.000Z'
};

describe('family page sealing matches shared/src/seal.ts', () => {
	it('page-sealed entries open with openEntry', async () => {
		const key = newCircleKey();
		const circle = randomId(16);
		const member = page.randomId(12);
		expect(member).toMatch(/^[A-Za-z0-9_-]{12}$/);
		const sealed = await page.sealEntry(key, circle, member, entry);
		expect(sealed.iv).toHaveLength(16);
		expect(await openEntry(key, circle, member, sealed)).toEqual(entry);
		// Bound to its circle and member.
		expect(await openEntry(key, circle, randomId(12), sealed)).toBeNull();
		expect(await openEntry(newCircleKey(), circle, member, sealed)).toBeNull();
	});

	it('app-sealed entries open on the page', async () => {
		const key = newCircleKey();
		const circle = randomId(16);
		const member = randomId(12);
		const sealed = await sealEntry(key, circle, member, { ...entry, via: 'app' });
		expect(await page.openEntry(key, circle, member, sealed)).toEqual({ ...entry, via: 'app' });
		expect(await page.openEntry(key, randomId(16), member, sealed)).toBeNull();
		expect(await page.openEntry(key, circle, member, { iv: 'x', ct: 'y' })).toBeNull();
	});

	it('checks the key from the link', async () => {
		expect(await page.keyOk(newCircleKey())).toBe(true);
		expect(await page.keyOk('')).toBe(false);
		expect(await page.keyOk('abc')).toBe(false);
		expect(await page.keyOk(newCircleKey().slice(0, 40))).toBe(false);
	});
});

describe('family page times', () => {
	(globalThis as any).process.env.TZ = 'Asia/Kolkata';
	const t = new Function(`${TIME_JS}; return { chipWindow, chipWindows, parsedWindows, isoLocal };`)() as any;

	it('maps chips to the coming weekend in the viewer zone', () => {
		const now = new Date('2026-10-30T18:10:00+05:30'); // Friday
		expect(t.isoLocal(now)).toBe('2026-10-30T18:10:00+05:30');
		expect(t.chipWindows(['sun-pm'], now)).toEqual([{ start: '2026-11-01T17:00:00+05:30', end: '2026-11-01T21:00:00+05:30' }]);
		expect(t.chipWindows(['sat-am', 'sun-am'], now)).toEqual([
			{ start: '2026-10-31T09:00:00+05:30', end: '2026-10-31T12:00:00+05:30' },
			{ start: '2026-11-01T09:00:00+05:30', end: '2026-11-01T12:00:00+05:30' }
		]);
	});

	it('merges morning and evening of one day, so four chips make two windows', () => {
		const now = new Date('2026-10-30T18:10:00+05:30');
		expect(t.chipWindows(['sun-pm', 'sat-am', 'sun-am', 'sat-pm'], now)).toEqual([
			{ start: '2026-10-31T09:00:00+05:30', end: '2026-10-31T21:00:00+05:30' },
			{ start: '2026-11-01T09:00:00+05:30', end: '2026-11-01T21:00:00+05:30' }
		]);
	});

	it('skips a window that has ended and stays within 7 days', () => {
		const sun = new Date('2026-11-01T13:00:00+05:30');
		expect(t.chipWindow('sun-am', sun)).toEqual({ start: new Date('2026-11-08T09:00:00+05:30'), end: new Date('2026-11-08T12:00:00+05:30') });
		expect(t.chipWindow('sun-pm', sun).start).toEqual(new Date('2026-11-01T17:00:00+05:30'));
		const lateSun = new Date('2026-11-01T21:30:00+05:30');
		expect(t.chipWindow('sun-pm', lateSun).start).toEqual(new Date('2026-11-08T17:00:00+05:30'));
		for (const c of ['sat-am', 'sat-pm', 'sun-am', 'sun-pm']) {
			const w = t.chipWindow(c, lateSun);
			expect(w.start.getTime() - lateSun.getTime()).toBeLessThan(7 * 86_400_000);
			expect(w.end.getTime()).toBeGreaterThan(lateSun.getTime());
		}
		expect(t.chipWindow('nope', sun)).toBeNull();
	});

	it('turns a windows answer into local ISO windows', () => {
		const now = new Date('2026-10-30T18:10:00+05:30');
		const out = t.parsedWindows({ windows: [{ day: '2026-11-01', start: '17:00', end: '20:00' }, { day: '2026-10-29', start: '17:00', end: '20:00' }, { day: 'x', start: '1', end: '2' }] }, now);
		expect(out).toEqual([{ start: '2026-11-01T17:00:00+05:30', end: '2026-11-01T20:00:00+05:30' }]);
	});
});

describe('GET /c/:id', () => {
	const id = randomId(16);

	it('serves the page with a nonce CSP, no referrer and the mic allowed', async () => {
		const res = await route(get(`/c/${id}`), makeEnv());
		expect(res.status).toBe(200);
		expect(res.headers.get('content-type')).toContain('text/html');
		expect(res.headers.get('referrer-policy')).toBe('no-referrer');
		expect(res.headers.get('cache-control')).toBe('no-store');
		expect(res.headers.get('permissions-policy')).toContain('microphone=(self)');
		const csp = res.headers.get('content-security-policy')!;
		const n = /script-src 'nonce-([^']+)'/.exec(csp)![1];
		expect(csp).toContain("connect-src 'self'");
		expect(csp).toContain("default-src 'none'");
		const html = await res.text();
		expect(html).toContain(`<script nonce="${n}">`);
		expect(html).toContain(`<style nonce="${n}">`);
		expect(html).toContain(`data-circle="${id}"`);
		expect(html).toContain('<meta name="referrer" content="no-referrer">');
		// No outside resources and no inline handlers.
		expect(html).not.toMatch(/\s(src|href)="https?:/);
		expect(html).not.toMatch(/\son[a-z]+="/);
		expect(html).not.toMatch(/\sstyle="/);
	});

	it('has the four chips, not this weekend and the mic, in plain English', async () => {
		const html = await (await route(get(`/c/${id}`), makeEnv())).text();
		for (const c of ['sat-am', 'sat-pm', 'sun-am', 'sun-pm']) expect(html).toContain(`data-chip="${c}"`);
		for (const label of ['Sat morning', 'Sun evening', 'Not this weekend', 'Speak instead', 'or type it', 'This link is incomplete', 'Ask for a new one']) expect(html).toContain(label);
		expect(html).not.toMatch(/[\u0900-\u097F]/);
		expect(html).not.toContain('lang="hi"');
		expect(html).not.toContain('—');
	});

	it('every element the script uses is in the page', () => {
		return renderFamilyPage(id)
			.text()
			.then((html) => {
				const script = html.slice(html.indexOf('<script'));
				const ids = new Set([...script.matchAll(/\$\('([\w-]+)'\)/g)].map((m) => m[1]));
				for (const s of script.matchAll(/\['(s-[\w-]+)'(?:,'(s-[\w-]+)')*/g)) ids.add(s[1]);
				expect(ids.size).toBeGreaterThan(15);
				for (const x of ids) expect(html).toContain(`id="${x}"`);
			});
	});

	it('the inline script parses', async () => {
		const html = await renderFamilyPage(id).text();
		const src = /<script nonce="[^"]+">([\s\S]*)<\/script>/.exec(html)![1];
		expect(() => new Function(src)).not.toThrow();
	});

	it('a malformed id still gets the page, which says the link is incomplete', async () => {
		const res = await route(get('/c/%3Cscript%3E'), makeEnv());
		expect(res.status).toBe(200);
		expect(await res.text()).toContain('data-circle=""');
		expect((await route(get('/c/a/b'), makeEnv())).status).toBe(200);
	});

	it('only answers GET and HEAD', async () => {
		const res = await route(new Request(`https://kizuna.test/c/${id}`, { method: 'POST' }), makeEnv());
		expect(res.status).toBe(405);
	});
});
