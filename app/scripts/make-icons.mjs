// Draws the Kizuna mark as SVG files and renders the PNG app icons into static/.
// Run from app/: node scripts/make-icons.mjs  (needs playwright with chromium)
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const out = (f) => fileURLToPath(new URL(`../static/${f}`, import.meta.url));

const INK = '#2a231e';
const PAPER = '#fbf8f3';
const PERSIMMON = '#d9572b';

// Two rings; short arcs are redrawn over a paper-coloured band so the rings pass over and under.
function knot({ ink = INK, accent = PERSIMMON, paper = PAPER } = {}) {
	return `<g transform="rotate(-28 50 50)" fill="none" stroke-width="8" stroke-linecap="butt">
<circle class="ink" cx="37" cy="50" r="20" stroke="${ink}"/>
<circle cx="63" cy="50" r="20" stroke="${accent}"/>
<path class="paper" d="${TOP}" stroke="${paper}" stroke-width="13"/><path class="ink" d="${TOP}" stroke="${ink}" stroke-linecap="round"/>
<path class="paper" d="${BOTTOM}" stroke="${paper}" stroke-width="13"/><path d="${BOTTOM}" stroke="${accent}" stroke-linecap="round"/>
</g>`;
}
const TOP = 'M43.36 31.04 A20 20 0 0 1 54.75 40.78';
const BOTTOM = 'M56.64 68.96 A20 20 0 0 1 45.25 59.22';

// favicon: a paper tile that turns charcoal in dark mode
const favicon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><style>@media (prefers-color-scheme: dark){.tile{fill:#1c1916}.paper{stroke:#1c1916}.ink{stroke:#f1ebe3}}</style><rect class="tile" width="100" height="100" rx="24" fill="${PAPER}"/><g transform="translate(5 5) scale(0.9)">${knot()}</g></svg>
`;
writeFileSync(out('favicon.svg'), favicon);

// app icon: paper background, knot scaled into the centre (scale 0.62 keeps it in the maskable safe zone)
function icon(scale) {
	const t = 50 - 50 * scale;
	return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="${PAPER}"/><g transform="translate(${t} ${t}) scale(${scale})">${knot()}</g></svg>`;
}
writeFileSync(out('icon.svg'), icon(0.78) + '\n');

const browser = await chromium.launch();
const page = await browser.newPage();
async function png(svg, size, file) {
	await page.setViewportSize({ width: size, height: size });
	await page.setContent(
		`<html><body style="margin:0">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`
	);
	await page.screenshot({ path: out(file), omitBackground: false });
}
await png(icon(0.78), 192, 'icon-192.png');
await png(icon(0.78), 512, 'icon-512.png');
await png(icon(0.62), 512, 'icon-maskable-512.png');
await png(icon(0.72), 180, 'apple-touch-icon.png');
await browser.close();
console.log('icons written');
