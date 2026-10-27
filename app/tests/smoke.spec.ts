import { expect, test, type Page } from '@playwright/test';

// Daytime, so suggested times on Today are the same day.
test.beforeEach(async ({ page }) => {
	await page.clock.setFixedTime(new Date('2026-10-26T11:00:00+05:30'));
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
	await page.getByRole('textbox').fill('Kabir started his new job, should call him.');
	await page.getByRole('button', { name: 'Save' }).click();
	await expect(page.getByText('Got it.')).toBeVisible();
});

test('the map shows the circle and a weekend plan', async ({ page }) => {
	// Friday evening before Diwali: the weekend card may appear.
	await page.clock.setFixedTime(new Date('2026-11-06T18:30:00+05:30'));
	await sampleFamily(page);
	await expect(page.getByRole('heading', { level: 1, name: 'Who’s open to a call' })).toBeVisible();
	await expect.poll(() => page.locator('a.dotlink').count(), { timeout: 10_000 }).toBeGreaterThanOrEqual(6);
	await expect(page.locator('article.weekend')).toBeVisible({ timeout: 15_000 });
});
