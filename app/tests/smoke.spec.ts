import { expect, test } from '@playwright/test';

// Daytime, so Today is allowed to show people (quiet hours hide them).
test.beforeEach(async ({ page }) => {
	await page.clock.setFixedTime(new Date('2026-10-26T11:00:00+05:30'));
});

test('sample life fills Today with at least one card', async ({ page }) => {
	await page.goto('/');
	await page.getByRole('button', { name: 'Try with sample life' }).click();
	await expect(page.locator('article.moment').first()).toBeVisible({ timeout: 15_000 });
	await expect(page.getByText('How much room today?').first()).toBeVisible();
});

test('the three places open', async ({ page }) => {
	await page.goto('/');
	await page.getByRole('button', { name: 'Try with sample life' }).click();
	await expect(page.locator('article.moment').first()).toBeVisible({ timeout: 15_000 });
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
