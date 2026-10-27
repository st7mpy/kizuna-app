import { expect, test, type Page } from '@playwright/test';

// Daytime, so suggested times on Today are the same day.
test.beforeEach(async ({ page }) => {
	await page.clock.setFixedTime(new Date('2026-10-26T11:00:00-05:00'));
});

/** A first visit lands on the landing page; its main button loads the sample family and opens the map. */
async function sampleFamily(page: Page) {
	await page.goto('/');
	await expect(page.getByRole('heading', { level: 1, name: /free to talk/ })).toBeVisible();
	await page.getByRole('button', { name: 'Try it with a sample family' }).first().click();
	await expect(page).toHaveURL(/\/map$/, { timeout: 15_000 });
}

async function openToday(page: Page) {
	await page.locator('nav[aria-label="Main"] a.tab[href="/"]').click();
	await expect(page.locator('article.moment').first()).toBeVisible({ timeout: 15_000 });
}

test('the landing page leads into the sample family', async ({ page }) => {
	await sampleFamily(page);
	await expect(page.getByRole('heading', { level: 1, name: 'Who’s open to a call' })).toBeVisible();
	// Once inside, "/" is Today, not the landing again.
	await openToday(page);
	await expect(page.getByText('How much room today?').first()).toBeVisible();
	await expect(page.locator('.landing')).toHaveCount(0);
});

test('start with your own goes to Talk and stays in the app', async ({ page }) => {
	await page.goto('/');
	await page.getByRole('button', { name: 'Start with your own' }).first().click();
	await expect(page).toHaveURL(/\/talk$/);
	await page.goto('/');
	await expect(page.locator('.landing')).toHaveCount(0);
	await page.goto('/about');
	await expect(page.getByRole('heading', { level: 1, name: /free to talk/ })).toBeVisible();
});

test('the three places open', async ({ page }) => {
	await sampleFamily(page);
	await openToday(page);
	await page.getByRole('link', { name: 'Circle' }).click();
	await expect(page.getByRole('heading', { level: 1, name: 'Your circle' })).toBeVisible();
	await expect(page.locator('a.person').first()).toBeVisible();
	await page.getByRole('link', { name: 'Talk' }).click();
	await expect(page.getByRole('heading', { name: 'What’s on your mind?' })).toBeVisible();
});

test('typing a note is understood or kept', async ({ page }) => {
	await page.goto('/talk');
	await page.getByRole('textbox').fill('Jordan started his new job, should call him.');
	await page.getByRole('button', { name: 'Save' }).click();
	await expect(page.getByText('Got it.')).toBeVisible();
});

test('the map shows the circle and a weekend plan', async ({ page }) => {
	// Friday evening: the weekend card may appear.
	await page.clock.setFixedTime(new Date('2026-11-06T18:30:00-06:00'));
	await sampleFamily(page);
	await expect(page.getByRole('heading', { level: 1, name: 'Who’s open to a call' })).toBeVisible();
	await expect.poll(() => page.locator('a.dotlink').count(), { timeout: 10_000 }).toBeGreaterThanOrEqual(6);
	await expect(page.locator('article.weekend')).toBeVisible({ timeout: 15_000 });
});

test('the other sample family loads from the picker', async ({ page }) => {
	await page.goto('/');
	await page.getByRole('button', { name: 'One big family across the USA' }).first().click();
	await expect(page).toHaveURL(/\/map$/, { timeout: 15_000 });
	await expect.poll(() => page.locator('a.dotlink').count(), { timeout: 10_000 }).toBeGreaterThanOrEqual(8);
	await expect(page.locator('article.weekend')).toBeVisible({ timeout: 15_000 });
	await expect(page.getByText('Grandpa').first()).toBeVisible();
	// The family lives in Chicago, so the plan reads the same wherever the visitor is.
	await expect(page.locator('article.weekend .yours').first()).toHaveText('Chicago time');
	await expect(page.locator('article.weekend .when .num').first()).toHaveText('Sunday 13:30');
});

test('Today closes the loop: who answered, and who hasn’t yet', async ({ page }) => {
	await sampleFamily(page);
	await openToday(page);
	const loop = page.locator('section.loop');
	await expect(loop.getByText('Grandma answered: Sunday afternoon')).toBeVisible();
	await expect(loop.getByText('Jordan hasn’t answered yet')).toBeVisible();
	// a gentle line for the user to send themselves
	await loop.getByRole('button', { name: 'Draft a nudge' }).click();
	await expect(loop.locator('textarea')).toHaveValue(/Jordan/, { timeout: 15_000 });
	await expect(loop.getByRole('button', { name: 'Open WhatsApp' })).toBeEnabled();
	// closing the answered line keeps it closed
	await loop.getByRole('button', { name: /^Close: Grandma answered/ }).click();
	await expect(page.getByText('Grandma answered: Sunday afternoon')).toHaveCount(0);
});

/** The model answers drafts slowly (or not at all); everything else fails fast. */
async function slowModel(page: Page, ms: number, line = 'Hey, thinking of you. Catch up soon?') {
	await page.route('**/api/spark', async (route) => {
		const body = route.request().postDataJSON() as { task?: string } | null;
		if (body?.task !== 'draft') return route.fulfill({ status: 502, json: { ok: false, error: 'model_error' } });
		await new Promise((r) => setTimeout(r, ms));
		await route.fulfill({ json: { ok: true, output: { line, language: 'en' } } }).catch(() => {});
	});
}

test('Poke shows a line to send within a second, even when the model is slow', async ({ page }) => {
	await slowModel(page, 3_000, 'MODEL: hey, thinking of you');
	await sampleFamily(page);
	await openToday(page);
	const t0 = Date.now();
	await page.locator('article.moment').getByRole('button', { name: 'Poke' }).first().click();
	const sheet = page.getByRole('dialog');
	const box = sheet.locator('textarea');
	await expect(box).toHaveValue(/^Hi \S+, thinking of you/, { timeout: 1_000 });
	expect(Date.now() - t0).toBeLessThan(1_500);
	await expect(box).toBeEditable();
	await expect(sheet.getByRole('button', { name: /Send in WhatsApp/ })).toBeEnabled();
	// the text never touches the border
	const pad = await box.evaluate((el) => parseFloat(getComputedStyle(el).paddingLeft));
	expect(pad).toBeGreaterThanOrEqual(12);
	// the warmer line swaps in when it arrives
	await expect(box).toHaveValue('MODEL: hey, thinking of you', { timeout: 8_000 });
});

test('Poke never replaces what the user started typing', async ({ page }) => {
	await slowModel(page, 2_000, 'MODEL: late line');
	await sampleFamily(page);
	await openToday(page);
	await page.locator('article.moment').getByRole('button', { name: 'Poke' }).first().click();
	const box = page.getByRole('dialog').locator('textarea');
	await expect(box).toHaveValue(/^Hi /, { timeout: 1_000 });
	await box.fill('My own words');
	await page.waitForTimeout(3_000);
	await expect(box).toHaveValue('My own words');
});

test('Poke: a late answer from an earlier opening is ignored', async ({ page }) => {
	let n = 0;
	await page.route('**/api/spark', async (route) => {
		const body = route.request().postDataJSON() as { task?: string } | null;
		if (body?.task !== 'draft') return route.fulfill({ status: 502, json: { ok: false, error: 'model_error' } });
		const mine = ++n;
		await new Promise((r) => setTimeout(r, mine === 1 ? 2_500 : 600));
		await route.fulfill({ json: { ok: true, output: { line: `REQ${mine}`, language: 'en' } } }).catch(() => {});
	});
	await sampleFamily(page);
	await openToday(page);
	const poke = page.locator('article.moment').getByRole('button', { name: 'Poke' }).first();
	await poke.click();
	await page.keyboard.press('Escape');
	await poke.click();
	const box = page.getByRole('dialog').locator('textarea');
	await expect(box).toHaveValue('REQ2', { timeout: 5_000 });
	await page.waitForTimeout(2_500);
	await expect(box).toHaveValue('REQ2');
});
