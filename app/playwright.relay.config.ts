import { defineConfig, devices } from '@playwright/test';

// Deep links against the Worker that serves the built app (wrangler dev), like production.
// Build first, start `wrangler dev --port <port>` in relay/, then: PW_PORT=<port> npx playwright test -c playwright.relay.config.ts
const port = Number(process.env.PW_PORT) || 8787;

export default defineConfig({
	testDir: 'tests',
	testMatch: 'deeplink.spec.ts',
	timeout: 30_000,
	use: {
		baseURL: `http://localhost:${port}`,
		...devices['Pixel 7'],
		timezoneId: process.env.PW_TZ || 'America/Chicago'
	}
});
