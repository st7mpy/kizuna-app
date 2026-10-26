// GET/POST /p/:id: the page the other person opens. One self-contained HTML
// document (inline CSS and JS under a nonce CSP), works without JavaScript; the
// script only rewrites times into the viewer's own time zone.
import { googleCalendarLink, slotLabel, type Slot } from '@kizuna/shared';
import type { Env } from './env.ts';
import { escapeHtml } from './http.ts';
import { limits } from './ratelimit.ts';
import { icsFor, ID_RE, loadInvite, savePick, type StoredInvite } from './invite.ts';

function nonce(): string {
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
			"form-action 'self'",
			"base-uri 'none'",
			"frame-ancestors 'none'"
		].join('; ')
	};
}

// Same paper, ink and indigo as the app. System fonts only: the CSP allows no font loads.
const GRAIN = `url("data:image/svg+xml;base64,${btoa(
	`<svg xmlns='http://www.w3.org/2000/svg' width='180' height='180'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='1.1' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 0.5 0 0 0 0 0.5 0 0 0 0 0.5 0 0 0 1.1 -0.3'/></filter><rect width='100%' height='100%' filter='url(#n)'/></svg>`
)}")`;

const CSS = `
:root{--bg:#F3F3F0;--text:#121214;--muted:#55545C;--faint:#6B6A72;--line:#D6D5CF;--rule:#121214;--on-rule:#F3F3F0;--accent:#2B3A92;--on-accent:#FFFFFF;--seal:#D4432A;color-scheme:light dark;
--sans:system-ui,-apple-system,"Segoe UI",Roboto,"Noto Sans","Helvetica Neue",Arial,sans-serif;--serif:"Iowan Old Style","Palatino Linotype",Palatino,Georgia,"Noto Serif",serif}
@media (prefers-color-scheme:dark){:root{--bg:#0D0D0F;--text:#ECECE8;--muted:#A9A8B0;--faint:#8E8D95;--line:#2B2B30;--rule:#ECECE8;--on-rule:#0D0D0F;--accent:#A3ADFF;--on-accent:#0D0D0F;--seal:#F0603F}}
*{box-sizing:border-box}
html,body{margin:0;background:var(--bg);color:var(--text)}
body{font:17px/1.5 var(--sans);-webkit-font-smoothing:antialiased;min-height:100vh;display:flex;justify-content:center;padding:20px 20px 32px}
main{width:100%;max-width:440px;display:flex;flex-direction:column}
.brand{display:flex;align-items:center;gap:9px;font-weight:600;font-size:16px;letter-spacing:-.015em;margin:0 0 56px}
.brand svg{display:block}
.eyebrow{font-size:12px;font-weight:500;letter-spacing:.08em;text-transform:uppercase;color:var(--faint);margin:0 0 12px}
h1{font-size:42px;line-height:1.04;font-weight:500;letter-spacing:-.035em;margin:0 0 14px;text-wrap:balance}
.sub{color:var(--muted);font-size:19px;line-height:1.4;margin:0 0 36px}
em{font-family:var(--serif);font-style:italic;font-weight:400}
form{margin:0}
.slots{margin:0;padding:0;list-style:none;border-top:1px solid var(--line)}
.slots li{border-bottom:1px solid var(--line)}
.slot{width:100%;display:flex;align-items:center;justify-content:space-between;gap:16px;text-align:left;font:inherit;color:inherit;background:none;border:0;padding:18px 0;min-height:96px;cursor:pointer}
.slot:focus-visible{outline:2px solid var(--accent);outline-offset:-2px;border-radius:4px}
.slot[disabled]{opacity:.45;cursor:default}
.slot .day{display:block;font-size:12px;font-weight:500;letter-spacing:.08em;text-transform:uppercase;color:var(--faint);margin-bottom:4px}
.slot .time{display:block;font-size:28px;line-height:1.1;letter-spacing:-.03em;font-variant-numeric:tabular-nums}
.go{flex:none;display:grid;place-items:center;width:48px;height:48px;border-radius:50%;background:var(--rule);color:var(--on-rule);transition:transform .15s}
.slot:hover .go{transform:translateX(3px)}
.slot:active .go{transform:scale(.94)}
.slot[disabled] .go{background:none;color:var(--faint);box-shadow:inset 0 0 0 1px var(--line);font-size:12px;width:auto;padding:0 14px;border-radius:999px;height:32px}
.tz{color:var(--faint);font-size:14px;margin:18px 0 0}
.picked{position:relative;overflow:hidden;border-radius:28px;padding:22px 22px 26px;min-height:200px;display:flex;flex-direction:column;justify-content:flex-end;color:#121214;
background:radial-gradient(130% 100% at 15% 0%,#6E7FC8 0%,transparent 62%),linear-gradient(172deg,#9CC6EE 0%,#D7E8F8 100%)}
.picked::after{content:"";position:absolute;inset:0;background-image:${GRAIN};background-size:180px;mix-blend-mode:multiply;opacity:.38;pointer-events:none}
.picked>*{position:relative;z-index:1}
.picked .label{font-size:12px;font-weight:500;letter-spacing:.08em;text-transform:uppercase;color:rgba(18,18,20,.72);margin:0 0 auto;padding-bottom:28px}
.picked .day{display:block;font-size:15px;font-weight:500}
.picked .time{display:block;font-size:34px;line-height:1.1;letter-spacing:-.035em;font-variant-numeric:tabular-nums}
.seal{position:absolute;top:18px;right:18px;z-index:1;transform:rotate(-8deg)}
.actions{display:grid;gap:10px;margin:24px 0 0}
.btn{display:flex;align-items:center;justify-content:center;min-height:54px;border-radius:999px;font-weight:500;text-decoration:none;padding:0 20px}
.btn.primary{background:var(--accent);color:var(--on-accent)}
.btn.secondary{color:var(--text);box-shadow:inset 0 0 0 1px var(--line)}
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

// The Kizuna mark: two rings, one in the seal colour. Inline SVG needs no namespace in HTML.
const MARK = `<svg width="24" height="24" viewBox="0 0 100 100" aria-hidden="true"><g transform="rotate(-28 50 50)" fill="none" stroke-width="8"><circle cx="37" cy="50" r="20" stroke="currentColor"/><circle cx="63" cy="50" r="20" stroke="var(--seal)"/><path d="M43.36 31.04 A20 20 0 0 1 54.75 40.78" stroke="var(--bg)" stroke-width="13"/><path d="M43.36 31.04 A20 20 0 0 1 54.75 40.78" stroke="currentColor" stroke-linecap="round"/><path d="M56.64 68.96 A20 20 0 0 1 45.25 59.22" stroke="var(--bg)" stroke-width="13"/><path d="M56.64 68.96 A20 20 0 0 1 45.25 59.22" stroke="var(--seal)" stroke-linecap="round"/></g></svg>`;

const ARROW = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>`;

const SEAL = `<svg class="seal" width="64" height="64" viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="46" fill="#D4432A"/><circle cx="50" cy="50" r="39" fill="none" stroke="#F7F1E8" stroke-width="2.5"/><g transform="rotate(-28 50 50)" fill="none" stroke="#F7F1E8" stroke-width="5.5"><circle cx="41" cy="50" r="13"/><circle cx="59" cy="50" r="13"/></g></svg>`;

function shell(title: string, body: string, status = 200): Response {
	const n = nonce();
	const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="referrer" content="no-referrer">
<meta name="robots" content="noindex, nofollow">
<meta name="theme-color" content="#F3F3F0" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#0D0D0F" media="(prefers-color-scheme: dark)">
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
<h1>You're <em>set</em>.</h1>
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
