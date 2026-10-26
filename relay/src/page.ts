// GET/POST /p/:id: the page the other person opens. One self-contained HTML
// document (inline CSS and JS under a nonce CSP), works without JavaScript; the
// script only rewrites times into the viewer's own time zone.
import { slotLabel, type Slot } from '@kizuna/shared';
import type { Env } from './env.ts';
import { escapeHtml } from './http.ts';
import { limits } from './ratelimit.ts';
import { ID_RE, loadInvite, savePick, type StoredInvite } from './invite.ts';

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

const CSS = `
:root{--bg:#FAF7F2;--card:#FFFFFF;--text:#2B2420;--muted:#6F635A;--line:#E9E1D6;--accent:#D9572B;--accent-ink:#FFFFFF;--soft:#FBEDE6;color-scheme:light dark}
@media (prefers-color-scheme:dark){:root{--bg:#1A1714;--card:#24201C;--text:#F3EDE5;--muted:#AA9D90;--line:#3A332C;--accent:#EE7A4E;--accent-ink:#1A1714;--soft:#3A2820}}
*{box-sizing:border-box}
html,body{margin:0;background:var(--bg);color:var(--text)}
body{font:17px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,"Noto Sans","Helvetica Neue",Arial,sans-serif;-webkit-font-smoothing:antialiased;min-height:100vh;display:flex;justify-content:center;padding:40px 16px 32px}
main{width:100%;max-width:440px}
.mark{width:40px;height:40px;border-radius:50%;background:var(--soft);display:grid;place-items:center;margin-bottom:20px}
.mark span{width:14px;height:14px;border-radius:50%;background:var(--accent)}
h1{font-size:26px;line-height:1.25;font-weight:650;letter-spacing:-.01em;margin:0 0 6px}
.sub{color:var(--muted);margin:0 0 28px}
form{margin:0}
.slots{display:grid;gap:12px;margin:0;padding:0;list-style:none}
.slot{width:100%;display:flex;align-items:center;justify-content:space-between;gap:12px;text-align:left;font:inherit;color:inherit;background:var(--card);border:1.5px solid var(--line);border-radius:16px;padding:16px 18px;min-height:72px;cursor:pointer;transition:border-color .15s,transform .1s}
.slot:hover{border-color:var(--accent)}
.slot:active{transform:scale(.99)}
.slot:focus-visible{outline:3px solid var(--accent);outline-offset:2px}
.slot[disabled]{opacity:.45;cursor:default}
.slot .day{display:block;font-weight:600}
.slot .time{display:block;color:var(--muted);font-size:15px}
.slot .go{flex:none;color:var(--accent);font-weight:600;font-size:15px}
.tz{color:var(--muted);font-size:14px;margin:16px 2px 0}
.picked{background:var(--card);border:1.5px solid var(--accent);border-radius:16px;padding:18px}
.picked .label{color:var(--muted);font-size:14px;margin:0 0 2px}
.picked .day{font-weight:650;font-size:20px;display:block}
.picked .time{color:var(--text);display:block}
.actions{display:grid;gap:10px;margin:20px 0 0}
.btn{display:flex;align-items:center;justify-content:center;min-height:52px;border-radius:14px;font-weight:600;text-decoration:none;border:1.5px solid var(--accent);padding:0 16px}
.btn.primary{background:var(--accent);color:var(--accent-ink)}
.btn.secondary{color:var(--accent);background:transparent}
.btn:focus-visible{outline:3px solid var(--text);outline-offset:2px}
.note{margin:20px 2px 0;color:var(--text)}
.change{display:inline-block;margin-top:18px;color:var(--muted);font-size:15px}
footer{margin-top:44px;color:var(--muted);font-size:13px;text-align:center}
footer b{font-weight:600;color:var(--text)}
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

function shell(title: string, body: string, status = 200): Response {
	const n = nonce();
	const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="referrer" content="no-referrer">
<meta name="robots" content="noindex, nofollow">
<meta name="theme-color" content="#FAF7F2" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#1A1714" media="(prefers-color-scheme: dark)">
<title>${escapeHtml(title)}</title>
<style nonce="${n}">${CSS}</style>
</head>
<body>
<main>
<div class="mark" aria-hidden="true"><span></span></div>
${body}
<footer>Sent with <b>Kizuna</b></footer>
</main>
<script nonce="${n}">${JS}</script>
</body>
</html>`;
	return new Response(html, { status, headers: pageHeaders(n) });
}

function compact(ms: number): string {
	return new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

export function googleCalendarUrl(title: string, slot: Slot, details: string): string {
	const p = new URLSearchParams({
		action: 'TEMPLATE',
		text: title,
		dates: `${compact(Date.parse(slot.start))}/${compact(Date.parse(slot.end))}`,
		details
	});
	return `https://calendar.google.com/calendar/render?${p.toString()}`;
}

function icsText(s: string): string {
	return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

export function icsFor(id: string, inv: StoredInvite, index: number, now = Date.now()): string {
	const slot = inv.slots[index];
	const lines = [
		'BEGIN:VCALENDAR',
		'VERSION:2.0',
		'PRODID:-//Kizuna//Pick a time//EN',
		'CALSCALE:GREGORIAN',
		'METHOD:PUBLISH',
		'BEGIN:VEVENT',
		`UID:${id}-${index}@kizuna`,
		`DTSTAMP:${compact(now)}`,
		`DTSTART:${compact(Date.parse(slot.start))}`,
		`DTEND:${compact(Date.parse(slot.end))}`,
		`SUMMARY:${icsText(inv.title)}`,
		`DESCRIPTION:${icsText(`Picked on Kizuna. ${inv.fromName} can see your pick.`)}`,
		'END:VEVENT',
		'END:VCALENDAR'
	];
	return lines.join('\r\n') + '\r\n';
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
<span><span class="day">${escapeHtml(day)}</span><span class="time">${escapeHtml(time)}</span></span><span class="go" aria-hidden="true">${past ? 'Passed' : 'Pick'}</span></button></li>`;
		})
		.join('\n');
	const body = `<h1>${name} wants to catch up.</h1>
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
	const gcal = googleCalendarUrl(inv.title, slot, `Picked on Kizuna. ${inv.fromName} can see your pick.`);
	const body = `<h1>You're set.</h1>
<p class="sub">${name} will see your pick.</p>
<div class="picked" data-start="${escapeHtml(slot.start)}" data-end="${escapeHtml(slot.end)}">
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
	const body = `<h1>This invite has ended.</h1>
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
