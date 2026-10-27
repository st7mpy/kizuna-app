import { describe, expect, it } from 'vitest';
import { newCircleKey, openEntry, randomId, sealEntry, type CircleEntry } from '@kizuna/shared';
import { route } from '../src/index.ts';
import { LINK_JS, SEAL_JS, TIME_JS, renderFamilyPage } from '../src/family-page.ts';
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
		// A pasted link unfurls as a card; the tags never carry the key.
		expect(html).toContain('<meta property="og:title" content="Family call this weekend?">');
		expect(html).toContain('<meta property="og:description" content="Tap the times that work for you. Takes ten seconds, nothing to install.">');
		expect(html).toContain(`<meta property="og:url" content="https://kizuna.test/c/${id}">`);
		expect(html).toContain('<meta property="og:image" content="https://kizuna.test/og-invite.png">');
		expect(html).toContain('<meta property="og:image:width" content="1200">');
		expect(html).toContain('<meta name="twitter:card" content="summary_large_image">');
		// No outside resources and no inline handlers.
		expect(html).not.toMatch(/\s(src|href)="https?:/);
		expect(html).not.toMatch(/\son[a-z]+="/);
		expect(html).not.toMatch(/\sstyle="/);
	});

	it('has the four chips, not this weekend and the mic, in plain English', async () => {
		const html = await (await route(get(`/c/${id}`), makeEnv())).text();
		for (const c of ['sat-am', 'sat-pm', 'sun-am', 'sun-pm']) expect(html).toContain(`data-chip="${c}"`);
		for (const label of ['Sat morning', 'Sun evening', 'Not this weekend', 'Speak instead', 'or type it', 'This link is incomplete', 'Ask for a new one', 'Undo']) expect(html).toContain(label);
		// one tap saves: there is no separate send button for the chips
		expect(html).not.toContain('id="send"');
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

describe('family page link', () => {
	const link = new Function(`${LINK_JS}; return { linkParams };`)() as { linkParams: (h: string) => { key: string; from: string; forName: string } };

	it('reads the key, who is planning, and who the link is for', () => {
		const key = newCircleKey();
		expect(link.linkParams(`#k=${key}&from=Alex&for=Mom`)).toEqual({ key, from: 'Alex', forName: 'Mom' });
		expect(link.linkParams(`#k=${key}&for=Aunt%20Carmen`)).toEqual({ key, from: '', forName: 'Aunt Carmen' });
		expect(link.linkParams(`#k=${key}`)).toEqual({ key, from: '', forName: '' });
		expect(link.linkParams('')).toEqual({ key: '', from: '', forName: '' });
	});

	it('cleans names: no control characters or tags, one space, at most 40 characters', () => {
		const r = link.linkParams(`#k=x&for=${encodeURIComponent('  <b>Grand\u0000ma</b>\n  Rose ')}&from=${'A'.repeat(60)}`);
		expect(r.forName).toBe('bGrandma/b Rose');
		expect(r.from).toHaveLength(40);
	});
});

// ---------- the page script against a tiny DOM: one tap saves, undo, for=, sealing ----------

class El {
	textContent = '';
	hidden = false;
	disabled = false;
	value = '';
	attrs = new Map<string, string>();
	handlers = new Map<string, (() => void)[]>();
	children: El[] = [];
	constructor(public id: string) {}
	setAttribute(k: string, v: string) {
		this.attrs.set(k, v);
	}
	getAttribute(k: string) {
		return this.attrs.get(k) ?? null;
	}
	addEventListener(t: string, f: () => void) {
		this.handlers.set(t, [...(this.handlers.get(t) ?? []), f]);
	}
	querySelector(_: string) {
		return this.children[0] ?? null;
	}
	click() {
		for (const f of this.handlers.get('click') ?? []) f();
	}
	focus() {}
	scrollIntoView() {}
}

interface PageOpts {
	/** Sealed members the circle already has (GET /api/circle/:id). */
	members?: any[];
	/** PUT answers fail with this status. */
	putStatus?: number;
	/** Answers /api/spark (a promise the test can hold). */
	spark?: () => Promise<Response>;
}

async function runPage(hash: string, circleId: string, now: string, opts: PageOpts = {}) {
	const html = await renderFamilyPage(circleId).text();
	const src = /<script nonce="[^"]+">([\s\S]*)<\/script>/.exec(html)![1];
	const els = new Map<string, El>();
	for (const m of html.matchAll(/id="([\w-]+)"/g)) els.set(m[1], new El(m[1]));
	const chips = [...html.matchAll(/data-chip="([\w-]+)"/g)].map((m) => {
		const e = new El(m[1]);
		e.setAttribute('data-chip', m[1]);
		e.children.push(new El('when'));
		return e;
	});
	const kv = new Map<string, any>();
	const requests: { method: string; path: string }[] = [];
	const fetch = async (url: string, init: any = {}) => {
		const method = init.method ?? 'GET';
		requests.push({ method, path: url });
		const m = /\/m\/([\w-]+)$/.exec(url);
		if (url.startsWith('/api/spark') && opts.spark) return opts.spark();
		if (method === 'PUT' && opts.putStatus) return new Response('{}', { status: opts.putStatus });
		if (method === 'PUT') kv.set(m![1], JSON.parse(init.body));
		if (method === 'DELETE') kv.delete(m![1]);
		return new Response(JSON.stringify({ ok: true, id: circleId, members: opts.members ?? [] }), { status: 200 });
	};
	const storage = new Map<string, string>();
	const fixed = new Date(now);
	class FakeDate extends Date {
		constructor(...a: any[]) {
			super(...((a.length ? a : [fixed.getTime()]) as []));
		}
		static now() {
			return fixed.getTime();
		}
	}
	const env = {
		document: {
			body: { getAttribute: () => circleId },
			getElementById: (id: string) => els.get(id) ?? null,
			querySelectorAll: () => chips
		},
		location: { hash },
		localStorage: { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => storage.set(k, v) },
		navigator: {},
		window: { scrollTo() {} },
		fetch,
		Date: FakeDate
	};
	const names = Object.keys(env);
	new Function(...names, src)(...names.map((n) => (env as any)[n]));
	await new Promise((r) => setTimeout(r, 50));
	const settle = () => new Promise((r) => setTimeout(r, 50));
	return { els, chips, kv, requests, storage, settle };
}

describe('family page answers in one tap', () => {
	(globalThis as any).process.env.TZ = 'Asia/Kolkata';
	const circleId = randomId(16);
	const now = '2026-10-30T18:10:00+05:30';

	it('greets the person the link is for and fills in their name', async () => {
		const key = newCircleKey();
		const p = await runPage(`#k=${key}&from=Alex&for=Mom`, circleId, now);
		expect(p.els.get('s-ask')!.hidden).toBe(false);
		expect(p.els.get('hi')!.hidden).toBe(false);
		expect(p.els.get('hi')!.textContent).toBe('Hi Mom,');
		expect(p.els.get('title')!.textContent).toBe('Alex is planning a family call.');
		expect(p.els.get('name')!.value).toBe('Mom');
	});

	it('a tap saves at once, sealed so the app can open it; more taps add; undo goes back', async () => {
		const key = newCircleKey();
		const p = await runPage(`#k=${key}&for=Mom`, circleId, now);
		const sunPm = p.chips.find((c) => c.id === 'sun-pm')!;
		sunPm.click();
		await p.settle();
		expect(sunPm.getAttribute('aria-pressed')).toBe('true');
		expect(p.els.get('saved-text')!.textContent).toBe('Saved. Tap more if other times work.');
		expect(p.els.get('undo')!.hidden).toBe(false);
		const [memberId, sealed] = [...p.kv][0];
		const entry = await openEntry(key, circleId, memberId, sealed);
		expect(entry).toMatchObject({ v: 1, name: 'Mom', via: 'page', windows: [{ start: '2026-11-01T17:00:00+05:30', end: '2026-11-01T21:00:00+05:30' }] });

		// a second tap adds a time, the name was changed on the way
		p.els.get('name')!.value = 'Mum';
		p.chips.find((c) => c.id === 'sat-am')!.click();
		await p.settle();
		const two = await openEntry(key, circleId, memberId, p.kv.get(memberId));
		expect(two!.name).toBe('Mum');
		expect(two!.windows).toHaveLength(2);

		// undo: back to just Sunday evening
		p.els.get('undo')!.click();
		await p.settle();
		const back = await openEntry(key, circleId, memberId, p.kv.get(memberId));
		expect(back!.windows).toEqual(entry!.windows);
		expect(p.els.get('saved-text')!.textContent).toBe('Undone.');
	});

	it('undo after the first tap takes the answer away', async () => {
		const key = newCircleKey();
		const p = await runPage(`#k=${key}`, circleId, now);
		p.chips[0].click();
		await p.settle();
		expect(p.kv.size).toBe(1);
		p.els.get('undo')!.click();
		await p.settle();
		expect(p.kv.size).toBe(0);
		expect(p.requests.at(-1)!.method).toBe('DELETE');
	});

	it('"Not this weekend" saves at once and says thank you', async () => {
		const key = newCircleKey();
		const p = await runPage(`#k=${key}&for=Grandpa`, circleId, now);
		p.els.get('nope')!.click();
		await p.settle();
		const [memberId, sealed] = [...p.kv][0];
		expect(await openEntry(key, circleId, memberId, sealed)).toMatchObject({ name: 'Grandpa', notThisWeekend: true, windows: [] });
		expect(p.els.get('s-thanks')!.hidden).toBe(false);
		expect(p.els.get('thanks-title')!.textContent).toBe('Thank you, Grandpa.');
	});
});

describe('family page: who else answered, errors and waiting', () => {
	(globalThis as any).process.env.TZ = 'Asia/Kolkata';
	const circleId = randomId(16);
	const now = '2026-10-30T18:10:00+05:30';
	const sealedAs = async (key: string, name: string, via: 'app' | 'page') => {
		const memberId = randomId(12);
		return { memberId, ...(await sealEntry(key, circleId, memberId, { ...entry, name, via })) };
	};

	it('never lists the organiser as "Me": their name from the link, or nothing', async () => {
		const key = newCircleKey();
		const members = [await sealedAs(key, 'Me', 'app'), await sealedAs(key, 'Grandpa', 'page')];
		const p = await runPage(`#k=${key}&from=Alex`, circleId, now, { members });
		p.els.get('nope')!.click();
		await p.settle();
		expect(p.els.get('others')!.textContent).toBe('Also answered: Alex, Grandpa.');
		const q = await runPage(`#k=${key}`, circleId, now, { members });
		q.els.get('nope')!.click();
		await q.settle();
		expect(q.els.get('others')!.textContent).toBe('Also answered: Grandpa.');
	});

	it('a failed send says so right away', async () => {
		const key = newCircleKey();
		const p = await runPage(`#k=${key}`, circleId, now, { putStatus: 500 });
		p.els.get('nope')!.click();
		await p.settle();
		expect(p.els.get('err')!.hidden).toBe(false);
		expect(p.els.get('err')!.textContent).toMatch(/did not go through/);
		expect(p.els.get('s-thanks')!.hidden).toBe(true);
	});

	it('"Use this" waits visibly while the reply is read, and can\'t be sent twice', async () => {
		const key = newCircleKey();
		let answer!: (r: Response) => void;
		const p = await runPage(`#k=${key}`, circleId, now, { spark: () => new Promise((r) => (answer = r)) });
		p.els.get('reply')!.value = 'Sunday afternoon works';
		p.els.get('read')!.click();
		await p.settle();
		expect(p.els.get('read')!.disabled).toBe(true);
		expect(p.els.get('micstatus')!.textContent).toBe('Reading that…');
		answer(new Response(JSON.stringify({ ok: false }), { status: 500 }));
		await p.settle();
		expect(p.els.get('read')!.disabled).toBe(false);
		expect(p.els.get('micstatus')!.textContent).toBe('');
		expect(p.els.get('err')!.textContent).toMatch(/did not work/);
	});

	it('"Change my answer" says it replaces the earlier one', async () => {
		const key = newCircleKey();
		const p = await runPage(`#k=${key}`, circleId, now);
		p.els.get('again-note')!.hidden = true; // as in the page, before any answer
		p.els.get('nope')!.click();
		await p.settle();
		p.els.get('again')!.click();
		expect(p.els.get('s-ask')!.hidden).toBe(false);
		expect(p.els.get('again-note')!.hidden).toBe(false);
	});
});
