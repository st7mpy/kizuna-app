// Renders static/og-invite.png (1200x630): the card WhatsApp shows when a family link is pasted.
// Run from app/: node scripts/make-og-invite.mjs  (needs playwright with chromium)
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PATH || '@playwright/test');
const file = (f) => fileURLToPath(new URL(`../static/${f}`, import.meta.url));
const font = (w) => `data:font/woff2;base64,${readFileSync(file(`fonts/geist-${w}.woff2`)).toString('base64')}`;

const MARK = `<svg width="44" height="44" viewBox="0 0 100 100"><defs><linearGradient id="d" x1="40" y1="30" x2="86" y2="72" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#4f86d4"/><stop offset=".5" stop-color="#7d6fc8"/><stop offset="1" stop-color="#d9706c"/></linearGradient><mask id="c" maskUnits="userSpaceOnUse" x="0" y="0" width="100" height="100"><rect x="-20" y="-20" width="140" height="140" fill="#fff"/><g transform="rotate(-28 50 50)" fill="none" stroke="#000" stroke-width="13"><path d="M43.36 31.04 A20 20 0 0 1 54.75 40.78"/><path d="M56.64 68.96 A20 20 0 0 1 45.25 59.22"/></g></mask></defs><g fill="none" stroke-width="8"><g mask="url(#c)"><g transform="rotate(-28 50 50)"><circle cx="37" cy="50" r="20" stroke="#141311"/><circle cx="63" cy="50" r="20" stroke="url(#d)"/></g></g><g transform="rotate(-28 50 50)"><path d="M43.36 31.04 A20 20 0 0 1 54.75 40.78" stroke="#141311" stroke-linecap="round"/><path d="M56.64 68.96 A20 20 0 0 1 45.25 59.22" stroke="url(#d)" stroke-linecap="round"/></g></g></svg>`;

const chip = (a, b, on = false) => `<div class="chip${on ? ' on' : ''}"><span>${a}</span><small>${b}</small></div>`;

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face{font-family:Geist;font-weight:400;src:url(${font(400)}) format("woff2")}
@font-face{font-family:Geist;font-weight:500;src:url(${font(500)}) format("woff2")}
@font-face{font-family:Geist;font-weight:600;src:url(${font(600)}) format("woff2")}
*{box-sizing:border-box;margin:0}
body{width:1200px;height:630px;overflow:hidden;font-family:Geist,sans-serif;color:#141311;position:relative;
background:radial-gradient(55% 60% at 4% 0%,rgba(158,196,230,.75),transparent 72%),radial-gradient(50% 55% at 98% 2%,rgba(196,186,226,.7),transparent 72%),radial-gradient(70% 55% at 45% 108%,rgba(242,195,181,.75),transparent 72%),linear-gradient(180deg,#e7eef4 0%,#eee9f1 42%,#f5ece6 78%,#f7efe7 100%)}
.wrap{position:absolute;inset:0;padding:64px 72px;display:flex;gap:56px}
.left{flex:1;display:flex;flex-direction:column}
.brand{display:flex;align-items:center;gap:14px;font-size:30px;font-weight:600;letter-spacing:-.02em}
.eyebrow{margin-top:92px;font-size:20px;font-weight:500;letter-spacing:.16em;text-transform:uppercase;color:#2740ff}
h1{margin-top:18px;font-size:80px;line-height:1.02;font-weight:500;letter-spacing:-.045em}
p{margin-top:24px;font-size:30px;line-height:1.3;color:#46423c;max-width:560px}
.right{width:440px;display:grid;grid-template-columns:1fr 1fr;gap:16px;align-content:center;margin-top:40px}
.chip{height:150px;border-radius:30px;padding:24px 26px;display:flex;flex-direction:column;justify-content:center;gap:8px;
background:rgba(255,253,248,.62);box-shadow:0 0 0 1px rgba(40,30,60,.06),inset 0 1px 0 rgba(255,255,255,.8),0 18px 40px -18px rgba(70,55,90,.3);font-size:32px;font-weight:500;letter-spacing:-.02em}
.chip small{font-size:20px;font-weight:400;color:#615c52;letter-spacing:0}
.chip.on{background:#2740ff;color:#fff;box-shadow:0 18px 34px -16px #2740ff}
.chip.on small{color:rgba(255,255,255,.85)}
</style></head><body><div class="wrap">
<div class="left"><div class="brand">${MARK}<span>Kizuna</span></div>
<div class="eyebrow">No app needed</div>
<h1>Family call<br>this weekend?</h1>
<p>Tap the times that work for you. Ten seconds, nothing to install.</p></div>
<div class="right">${chip('Sat', 'morning')}${chip('Sat', 'evening')}${chip('Sun', 'morning', true)}${chip('Sun', 'evening')}</div>
</div></body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
await page.setContent(html);
await page.evaluate(() => document.fonts.ready);
await page.screenshot({ path: file('og-invite.png'), type: 'png' });
await browser.close();
console.log('wrote static/og-invite.png');
