import { expect, test } from '@playwright/test';

// Regressions from the live check on 2026-10-27.

test('Settings says "Connected" once the calendar link reads', async ({ page }) => {
	await page.clock.setFixedTime(new Date('2026-10-26T11:00:00-05:00'));
	await page.route('**/api/ical', (r) => r.fulfill({ json: { ok: true, busy: [] } }));
	await page.goto('/');
	await page.getByRole('button', { name: 'Start with your own' }).first().click();
	await expect(page).toHaveURL(/\/talk$/);
	await page.goto('/settings');
	const input = page.getByLabel('Private calendar link (iCal)');
	await input.fill('https://calendar.google.com/calendar/ical/x%40group.calendar.google.com/private-abc/basic.ics');
	await expect(page.getByText('Connected. Kizuna will avoid your busy times.')).toBeVisible({ timeout: 8000 });
	// And again on a later visit, without typing.
	await page.reload();
	await expect(page.getByText('Connected. Kizuna will avoid your busy times.')).toBeVisible({ timeout: 8000 });
});

test('a rate-limited first weave shows "Building your circle…" and retries after a minute', async ({ page }) => {
	let weaves = 0;
	await page.route('**/api/spark', async (route) => {
		const body = route.request().postDataJSON();
		if (body.task === 'extract') {
			const n = body.input.text.match(/^(\w+)/)[1];
			return route.fulfill({ json: { ok: true, output: { language: 'en', sensitive: false, people: [{ name: n, relation: 'friend' }], events: [], promises: [], threads: [], gift_hints: [] } } });
		}
		if (body.task === 'weave') {
			weaves++;
			if (weaves === 1) return route.fulfill({ status: 429, json: { ok: false, error: 'rate_limited' } });
			const people = body.input.people.map((p: { id: string; name: string }) => ({ id: p.id, name: p.name, aliases: [], merge_ids: [], relation: 'friend', closeness: 'close', suggest_circle: true, why: 'Comes up a lot.', summary: '' }));
			return route.fulfill({ json: { ok: true, output: { people, threads: [] } } });
		}
		return route.fulfill({ status: 500, json: { ok: false, error: 'model_error' } });
	});
	await page.clock.install({ time: new Date('2026-10-26T11:00:00-05:00') });
	await page.goto('/');
	await page.getByRole('button', { name: 'Start with your own' }).first().click();
	for (const t of ['Leo has exams this week.', 'Maya moved to a new flat.', 'Jordan started a new job.']) {
		await page.getByRole('textbox').fill(t);
		await page.getByRole('button', { name: 'Save' }).click();
		await expect(page.getByText('Got it.')).toBeVisible();
		await page.getByRole('button', { name: 'Add another' }).click();
	}
	await expect.poll(() => weaves, { timeout: 10_000 }).toBe(1);
	await page.getByRole('link', { name: 'Circle' }).click();
	await expect(page.getByText('Building your circle…')).toBeVisible();
	await page.clock.runFor(65_000);
	await expect.poll(() => weaves, { timeout: 10_000 }).toBe(2);
	await expect(page.getByRole('button', { name: 'Keep close' }).first()).toBeVisible({ timeout: 10_000 });
});
