import { expect, test, type Page } from '@playwright/test';

// Deep links and reloads, the way the Worker serves the built app (index.html for any unknown path).
// Run against wrangler dev: PW_PORT=<port> npx playwright test -c playwright.relay.config.ts

test.beforeEach(async ({ page }) => {
	await page.clock.setFixedTime(new Date('2026-10-26T11:00:00-05:00'));
});

async function sampleFamily(page: Page) {
	await page.goto('/');
	await page.getByRole('button', { name: 'Try it with a sample family' }).first().click();
	await expect(page).toHaveURL(/\/map$/, { timeout: 15_000 });
	await expect(page.locator('a.dotlink').first()).toBeAttached();
}

test('a person page opens on reload and from a new tab', async ({ page, context }) => {
	const errors: string[] = [];
	page.on('pageerror', (e) => errors.push(e.message));
	await sampleFamily(page);
	const href = (await page.locator('a.member').first().getAttribute('href'))!;
	expect(href).toMatch(/^\/circle\/[^/]+$/);
	const name = (await page.locator('a.member .name').first().textContent())!.trim();

	await page.goto(href);
	await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
	await page.reload();
	await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();

	// opened in a new tab (same browser, so the same phone data)
	const tab = await context.newPage();
	await tab.goto(href);
	await expect(tab.getByRole('heading', { level: 1, name })).toBeVisible();
	await tab.close();
	expect(errors).toEqual([]);
});

test('every place reloads, and an unknown address says so', async ({ page }) => {
	await sampleFamily(page);
	for (const [path, heading] of [
		['/map', 'Who’s open to a call'],
		['/settings', /Settings/],
		['/circle', 'Your circle']
	] as const) {
		await page.goto(path);
		await page.reload();
		await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
	}
	await page.goto('/about');
	await page.reload();
	await expect(page.getByRole('heading', { level: 1, name: /free to talk/ })).toBeVisible();
	for (const path of ['/nosuchpage', '/a/b/c']) {
		await page.goto(path);
		await expect(page.getByRole('heading', { level: 1, name: 'There’s nothing at this address.' })).toBeVisible();
		await expect(page.getByRole('link', { name: 'Back to Today' })).toBeVisible();
	}
});

test('the service worker installs from a deep link', async ({ page }) => {
	await sampleFamily(page);
	await page.goto('/map');
	const href = (await page.locator('a.member').first().getAttribute('href'))!;
	await page.goto(href);
	const scope = await page.evaluate(() => Promise.race([navigator.serviceWorker.ready.then((r) => r.scope), new Promise((r) => setTimeout(() => r('none'), 8000))]));
	expect(new URL(String(scope)).pathname).toBe('/');
});

test('a family reply nobody is linked to shows on the map and can be added', async ({ page }) => {
	await sampleFamily(page);
	// The sample keeps the invite card in reach.
	await expect(page.getByText('Try it with your own family.')).toBeVisible();
	await page.evaluate(
		() =>
			new Promise<void>((resolve, reject) => {
				const req = indexedDB.open('kizuna');
				req.onsuccess = () => {
					const tx = req.result.transaction('members', 'readwrite');
					const now = new Date().toISOString();
					tx.objectStore('members').put({
						memberId: 'page-rosalind',
						personId: null,
						entry: { v: 1, name: 'Grandma Rosalind', tz: 'America/Chicago', status: null, statusUntil: null, windows: [], via: 'page', updatedAt: now },
						fetchedAt: now,
						answeredAt: now
					});
					tx.oncomplete = () => resolve();
					tx.onerror = () => reject(tx.error);
				};
				req.onerror = () => reject(req.error);
			})
	);
	await page.reload();
	const row = page.locator('a.member', { hasText: 'Grandma Rosalind' });
	await expect(row).toContainText('Who is this?');
	await row.click();
	await expect(page).toHaveURL(/\/map\?who=page-rosalind$/);
	await page.getByRole('button', { name: 'Add Grandma Rosalind to your circle' }).click();
	await expect(page).toHaveURL(/\/map$/);
	await expect(page.locator('a.member', { hasText: 'Grandma Rosalind' })).not.toContainText('Who is this?');
	await expect(page.locator('a.member', { hasText: 'Grandma Rosalind' })).toHaveAttribute('href', /^\/circle\//);
});
