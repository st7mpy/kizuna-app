// GET/POST /p/:id: the page the other person opens. One self-contained HTML
// document (inline CSS and JS under a nonce CSP), works without JavaScript; the
// script only rewrites times into the viewer's own time zone.
import { googleCalendarLink, slotLabel, type Slot } from '@kizuna/shared';
import type { Env } from './env.ts';
import { escapeHtml } from './http.ts';
import { limits } from './ratelimit.ts';
import { icsFor, ID_RE, loadInvite, savePick, type StoredInvite } from './invite.ts';

export function nonce(): string {
	const b = crypto.getRandomValues(new Uint8Array(16));
	return btoa(String.fromCharCode(...b));
}

function pageHeaders(n: string): Record<string, string> {
	return {
		'content-type': 'text/html; charset=utf-8',
		'cache-control': 'no-store',
		'x-content-type-options': 'nosniff',
		'referrer-policy': 'no-referrer',
		'x-frame-options': 'DENY',
		'x-robots-tag': 'noindex, nofollow',
		'content-security-policy': [
			"default-src 'none'",
			`style-src 'nonce-${n}'`,
			`script-src 'nonce-${n}'`,
			"img-src data:",
			"font-src 'self'",
			"form-action 'self'",
			"base-uri 'none'",
			"frame-ancestors 'none'"
		].join('; ')
	};
}

// Same sky, glass, ink and blue as the app, in Geist served from the app's own /fonts.
const GRAIN = `url("data:image/svg+xml;base64,${btoa(
	`<svg xmlns='http://www.w3.org/2000/svg' width='180' height='180'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='1.1' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 0.5 0 0 0 0 0.5 0 0 0 0 0.5 0 0 0 1.1 -0.3'/></filter><rect width='100%' height='100%' filter='url(#n)'/></svg>`
)}")`;

export const CSS = `
@font-face{font-family:Geist;font-weight:400;font-display:swap;src:url(/fonts/geist-400.woff2) format("woff2")}
@font-face{font-family:Geist;font-weight:500;font-display:swap;src:url(/fonts/geist-500.woff2) format("woff2")}
@font-face{font-family:Geist;font-weight:600;font-display:swap;src:url(/fonts/geist-600.woff2) format("woff2")}
:root{--bg:#F7F3EA;--surface:rgba(255,253,248,.62);--surface-solid:#FFFCF6;--text:#141311;--muted:#46423C;--faint:#615C52;--line:rgba(20,19,17,.1);--line-2:rgba(20,19,17,.17);--rule:#141311;--on-rule:#F7F3EA;--accent:#2740FF;--accent-soft:rgba(39,64,255,.08);--on-accent:#FFFFFF;--danger:#B8432B;color-scheme:light dark;
--blur:blur(22px) saturate(1.5);--star:rgba(255,255,255,.5);
--card:0 0 0 1px rgba(40,30,60,.06),inset 0 1px 0 rgba(255,255,255,.75),0 12px 32px -16px rgba(70,55,90,.22);
--sky:radial-gradient(55% 45% at 6% 0%,rgba(158,196,230,.6),transparent 72%),radial-gradient(50% 42% at 96% 4%,rgba(196,186,226,.5),transparent 72%),radial-gradient(70% 45% at 40% 104%,rgba(242,195,181,.5),transparent 72%),linear-gradient(180deg,#E7EEF4 0%,#EEE9F1 42%,#F5ECE6 78%,#F7EFE7 100%);
--sans:Geist,system-ui,-apple-system,"Segoe UI",Roboto,"Noto Sans","Noto Sans Devanagari","Helvetica Neue",Arial,sans-serif}
@media (prefers-color-scheme:dark){:root{--bg:#18161A;--surface:rgba(46,40,58,.42);--surface-solid:#232027;--text:#EEECE8;--muted:#C4BFB6;--faint:#AAA59C;--line:rgba(236,232,245,.1);--line-2:rgba(236,232,245,.18);--rule:#EEECE8;--on-rule:#18161A;--accent:#5A9FEC;--accent-soft:rgba(90,159,236,.14);--on-accent:#0D1520;--danger:#EF7A5F;--blur:blur(22px) saturate(1.4);--star:rgba(255,255,255,.6);
--card:0 0 0 1px rgba(236,228,250,.08),inset 0 1px 0 rgba(255,255,255,.06),0 16px 40px -18px rgba(0,0,0,.6);
--sky:radial-gradient(60% 50% at 4% 0%,rgba(46,64,104,.9),transparent 72%),radial-gradient(48% 42% at 96% 6%,rgba(88,62,94,.6),transparent 72%),radial-gradient(60% 40% at 34% 104%,rgba(104,66,58,.5),transparent 72%),linear-gradient(180deg,#1C2234 0%,#211C2B 42%,#211A1E 74%,#18161A 100%)}}
*{box-sizing:border-box}
html{background:var(--bg)}
body{margin:0;color:var(--text)}
body{position:relative;isolation:isolate;font:17px/1.5 var(--sans);-webkit-font-smoothing:antialiased;min-height:100vh;display:flex;justify-content:center;padding:20px 20px 32px}
/* the same sky as the app and the landing: dawn in light, dusk with a few faint stars in dark */
body::before{content:"";position:fixed;inset:0;z-index:-1;background:var(--sky);pointer-events:none}
body::after{content:"";position:fixed;inset:0;z-index:-1;pointer-events:none;opacity:.35;background-image:radial-gradient(1.2px 1.2px at 12% 8%,var(--star),transparent),radial-gradient(1px 1px at 28% 22%,var(--star),transparent),radial-gradient(1.4px 1.4px at 47% 6%,var(--star),transparent),radial-gradient(1px 1px at 66% 16%,var(--star),transparent),radial-gradient(1.3px 1.3px at 83% 10%,var(--star),transparent),radial-gradient(1px 1px at 92% 30%,var(--star),transparent),radial-gradient(1.2px 1.2px at 8% 38%,var(--star),transparent),radial-gradient(1px 1px at 74% 44%,var(--star),transparent),radial-gradient(1.1px 1.1px at 36% 52%,var(--star),transparent),radial-gradient(1px 1px at 58% 33%,var(--star),transparent)}
@media (prefers-color-scheme:dark){body::after{opacity:1}}
.card,.glass{background:var(--surface);box-shadow:var(--card);-webkit-backdrop-filter:var(--blur);backdrop-filter:var(--blur)}
main{width:100%;max-width:440px;display:flex;flex-direction:column}
.brand{display:flex;align-items:center;gap:9px;font-weight:600;font-size:16px;letter-spacing:-.015em;margin:0 0 56px}
.brand svg{display:block}
.eyebrow{font-size:11px;font-weight:500;letter-spacing:.16em;text-transform:uppercase;color:var(--accent);margin:0 0 12px}
h1{font-size:42px;line-height:1.04;font-weight:500;letter-spacing:-.04em;margin:0 0 14px;text-wrap:balance}
.sub{color:var(--muted);font-size:19px;line-height:1.4;margin:0 0 36px}
em{font-style:normal}
form{margin:0}
.slots{margin:0;padding:0;list-style:none;display:grid;gap:10px}
.slots li{border-radius:22px;background:var(--surface);box-shadow:var(--card);-webkit-backdrop-filter:var(--blur);backdrop-filter:var(--blur)}
.slot{width:100%;display:flex;align-items:center;justify-content:space-between;gap:16px;text-align:left;font:inherit;color:inherit;background:none;border:0;padding:18px 18px 18px 22px;min-height:96px;cursor:pointer;border-radius:22px}
.slot:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.slot[disabled]{opacity:.45;cursor:default}
.slot .day{display:block;font-size:11px;font-weight:500;letter-spacing:.14em;text-transform:uppercase;color:var(--faint);margin-bottom:4px}
.slot .time{display:block;font-size:28px;font-weight:500;line-height:1.1;letter-spacing:-.04em;font-variant-numeric:tabular-nums}
.go{flex:none;display:grid;place-items:center;width:48px;height:48px;border-radius:50%;background:var(--rule);color:var(--on-rule);transition:transform .15s}
.slot:hover .go{transform:translateX(3px)}
.slot:active .go{transform:scale(.94)}
.slot[disabled] .go{background:none;color:var(--faint);box-shadow:inset 0 0 0 1px var(--line);font-size:12px;width:auto;padding:0 14px;border-radius:999px;height:32px}
.tz{color:var(--faint);font-size:14px;margin:18px 0 0}
.picked{position:relative;overflow:hidden;border-radius:22px;padding:22px 22px 26px;min-height:200px;display:flex;flex-direction:column;justify-content:flex-end;color:#141311;box-shadow:var(--card);
background:radial-gradient(120% 90% at 90% 0%,#F2C3B5 0%,transparent 60%),radial-gradient(130% 100% at 10% 0%,#9EC4E6 0%,transparent 65%),linear-gradient(172deg,#B7B3D6 0%,#F4ECE6 100%)}
.picked::after{content:"";position:absolute;inset:0;background-image:${GRAIN};background-size:180px;mix-blend-mode:multiply;opacity:.2;pointer-events:none}
.picked>*{position:relative;z-index:1}
.picked .label{font-size:11px;font-weight:500;letter-spacing:.14em;text-transform:uppercase;color:rgba(20,19,17,.66);margin:0 0 auto;padding-bottom:28px}
.picked .day{display:block;font-size:15px;font-weight:500}
.picked .time{display:block;font-size:34px;font-weight:500;line-height:1.1;letter-spacing:-.04em;font-variant-numeric:tabular-nums}
.seal{position:absolute;top:18px;right:18px;z-index:1;transform:rotate(-8deg)}
.actions{display:grid;gap:10px;margin:24px 0 0}
.btn{display:flex;align-items:center;justify-content:center;min-height:54px;border-radius:999px;font-weight:500;text-decoration:none;padding:0 20px;transition:transform .2s,box-shadow .2s}
.btn.primary{background:var(--accent);color:var(--on-accent);box-shadow:0 8px 18px -12px var(--accent)}
.btn.secondary{color:var(--text);background:var(--surface);box-shadow:inset 0 0 0 1px var(--line-2);-webkit-backdrop-filter:var(--blur);backdrop-filter:var(--blur)}
.btn:focus-visible,.change:focus-visible{outline:2px solid var(--accent);outline-offset:3px}
.change{align-self:flex-start;display:inline-flex;align-items:center;min-height:44px;margin-top:10px;color:var(--muted);font-size:15px}
footer{margin-top:auto;padding-top:56px;color:var(--faint);font-size:13px}
footer b{font-weight:600;color:var(--text)}
@media (prefers-reduced-motion:reduce){*{transition:none!important}}
`;

// Rewrites [data-start] times into the viewer's zone. No network calls.
const JS = `
(function(){
  try{
    var tz=Intl.DateTimeFormat().resolvedOptions().timeZone;
    var day=new Intl.DateTimeFormat(undefined,{weekday:'long',day:'numeric',month:'long'});
    var hm=new Intl.DateTimeFormat(undefined,{hour:'numeric',minute:'2-digit'});
    document.querySelectorAll('[data-start]').forEach(function(el){
      var s=new Date(el.getAttribute('data-start')),e=new Date(el.getAttribute('data-end'));
      if(isNaN(s)||isNaN(e))return;
      var d=el.querySelector('.day'),t=el.querySelector('.time');
      if(d)d.textContent=day.format(s);
      if(t)t.textContent=hm.format(s)+' to '+hm.format(e);
    });
    var z=document.getElementById('tz');
    if(z&&tz)z.textContent='Times are shown in your time zone ('+tz.replace(/_/g,' ')+').';
  }catch(_){}
  document.querySelectorAll('form').forEach(function(f){
    f.addEventListener('submit',function(){setTimeout(function(){f.querySelectorAll('button').forEach(function(b){b.disabled=true;});},0);});
  });
})();
`;

// The Kizuna mark: two rings, one ink and one in dawn colours. Inline SVG needs no namespace in HTML.
export const MARK = `<svg width="24" height="24" viewBox="0 0 100 100" aria-hidden="true"><defs><linearGradient id="k-dawn" x1="40" y1="30" x2="86" y2="72" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#4f86d4"/><stop offset=".5" stop-color="#7d6fc8"/><stop offset="1" stop-color="#d9706c"/></linearGradient><mask id="k-cut" maskUnits="userSpaceOnUse" x="0" y="0" width="100" height="100"><rect x="-20" y="-20" width="140" height="140" fill="#fff"/><g transform="rotate(-28 50 50)" fill="none" stroke="#000" stroke-width="13"><path d="M43.36 31.04 A20 20 0 0 1 54.75 40.78"/><path d="M56.64 68.96 A20 20 0 0 1 45.25 59.22"/></g></mask></defs><g fill="none" stroke-width="8"><g mask="url(#k-cut)"><g transform="rotate(-28 50 50)"><circle cx="37" cy="50" r="20" stroke="currentColor"/><circle cx="63" cy="50" r="20" stroke="url(#k-dawn)"/></g></g><g transform="rotate(-28 50 50)"><path d="M43.36 31.04 A20 20 0 0 1 54.75 40.78" stroke="currentColor" stroke-linecap="round"/><path d="M56.64 68.96 A20 20 0 0 1 45.25 59.22" stroke="url(#k-dawn)" stroke-linecap="round"/></g></g></svg>`;

const ARROW = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>`;

const SEAL = `<svg class="seal" width="64" height="64" viewBox="0 0 100 100" aria-hidden="true"><defs><linearGradient id="s-dawn" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#8fb6e2"/><stop offset=".5" stop-color="#a99fd6"/><stop offset="1" stop-color="#e79c95"/></linearGradient></defs><circle cx="50" cy="50" r="46" fill="url(#s-dawn)"/><circle cx="50" cy="50" r="39" fill="none" stroke="#FFFCF6" stroke-width="2.5"/><g transform="rotate(-28 50 50)" fill="none" stroke="#FFFCF6" stroke-width="5.5"><circle cx="41" cy="50" r="13"/><circle cx="59" cy="50" r="13"/></g></svg>`;

function shell(title: string, body: string, status = 200): Response {
	const n = nonce();
	const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="referrer" content="no-referrer">
<meta name="robots" content="noindex, nofollow">
<meta name="theme-color" content="#F7F3EA" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#161514" media="(prefers-color-scheme: dark)">
<title>${escapeHtml(title)}</title>
<style nonce="${n}">${CSS}</style>
</head>
<body>
<main>
<div class="brand">${MARK}<span>Kizuna</span></div>
${body}
<footer>Sent with <b>Kizuna</b></footer>
</main>
<script nonce="${n}">${JS}</script>
</body>
</html>`;
	return new Response(html, { status, headers: pageHeaders(n) });
}

function slotParts(inv: StoredInvite, s: Slot): { day: string; time: string } {
	// Server-side text in the sender's zone; the script swaps in the viewer's.
	const label = slotLabel(Date.parse(s.start), Date.parse(s.end), inv.timeZone);
	const [day, time] = label.split(', ');
	return { day, time: time ?? '' };
}

function zoneLine(inv: StoredInvite): string {
	return `<p class="tz" id="tz">Times are in ${escapeHtml(inv.timeZone.replace(/_/g, ' '))} time.</p>`;
}

export function renderPickPage(id: string, inv: StoredInvite, now = Date.now()): Response {
	const name = escapeHtml(inv.fromName);
	const items = inv.slots
		.map((s, i) => {
			const { day, time } = slotParts(inv, s);
			const past = Date.parse(s.start) < now;
			return `<li><button class="slot" type="submit" name="index" value="${i}"${past ? ' disabled' : ''} data-start="${escapeHtml(s.start)}" data-end="${escapeHtml(s.end)}">
<span><span class="day">${escapeHtml(day)}</span><span class="time">${escapeHtml(time)}</span></span>${past ? '<span class="go">Passed</span>' : `<span class="go" aria-hidden="true">${ARROW}</span>`}</button></li>`;
		})
		.join('\n');
	const body = `<p class="eyebrow">An invitation</p>
<h1>${name} wants to catch up.</h1>
<p class="sub">Pick a time that works.</p>
<form method="post" action="/p/${id}">
<ul class="slots">
${items}
</ul>
</form>
${zoneLine(inv)}`;
	return shell(`${inv.fromName} wants to catch up`, body);
}

export function renderPickedPage(id: string, inv: StoredInvite): Response {
	const index = inv.pickedIndex ?? 0;
	const slot = inv.slots[index];
	const { day, time } = slotParts(inv, slot);
	const name = escapeHtml(inv.fromName);
	const gcal = googleCalendarLink(slot, inv.title, `Picked on Kizuna. ${inv.fromName} can see your pick.`);
	const body = `<p class="eyebrow">Picked</p>
<h1>You're set.</h1>
<p class="sub">${name} will see your pick.</p>
<div class="picked" data-start="${escapeHtml(slot.start)}" data-end="${escapeHtml(slot.end)}">
${SEAL}
<p class="label">${escapeHtml(inv.title)}</p>
<span class="day">${escapeHtml(day)}</span><span class="time">${escapeHtml(time)}</span>
</div>
<div class="actions">
<a class="btn primary" href="${escapeHtml(gcal)}" target="_blank" rel="noopener noreferrer">Add to Google Calendar</a>
<a class="btn secondary" href="/p/${id}/invite.ics" download="kizuna.ics">Download .ics</a>
</div>
${zoneLine(inv)}
<a class="change" href="/p/${id}?change=1">Pick a different time</a>`;
	return shell(`Catch up with ${inv.fromName}`, body);
}

export function renderGonePage(): Response {
	const body = `<p class="eyebrow">Invite</p>
<h1>This invite has ended.</h1>
<p class="sub">Invites last a week, or the link may be incomplete. If you still want to meet, send a quick message to whoever shared it and they can send a fresh one.</p>`;
	return shell('Invite ended', body, 404);
}

export async function handlePage(req: Request, env: Env, id: string, rest: string): Promise<Response> {
	if (!ID_RE.test(id)) return renderGonePage();
	if (rest === '/invite.ics' && req.method === 'GET') {
		const inv = await loadInvite(env, id);
		if (!inv) return renderGonePage();
		const i = Number(new URL(req.url).searchParams.get('i') ?? inv.pickedIndex ?? 0);
		if (!Number.isInteger(i) || i < 0 || i >= inv.slots.length) return renderGonePage();
		return new Response(icsFor(id, inv, i), {
			headers: {
				'content-type': 'text/calendar; charset=utf-8',
				'content-disposition': 'attachment; filename="kizuna.ics"',
				'cache-control': 'no-store',
				'x-content-type-options': 'nosniff'
			}
		});
	}
	if (rest !== '' && rest !== '/') return renderGonePage();

	if (req.method === 'POST') {
		if (!limits.invite.allow(req)) return shell('Try again shortly', '<h1>One moment.</h1><p class="sub">Too many tries just now. Please go back and pick again in a minute.</p>', 429);
		const form = await req.formData().catch(() => null);
		const index = Number(form?.get('index'));
		const r = await savePick(env, id, index);
		if (r === 'not_found') return renderGonePage();
		return new Response(null, { status: 303, headers: { location: `/p/${id}`, 'cache-control': 'no-store' } });
	}
	if (req.method !== 'GET' && req.method !== 'HEAD') return new Response('Method not allowed', { status: 405 });

	const inv = await loadInvite(env, id);
	if (!inv) return renderGonePage();
	const change = new URL(req.url).searchParams.has('change');
	return inv.pickedIndex != null && !change ? renderPickedPage(id, inv) : renderPickPage(id, inv);
}
