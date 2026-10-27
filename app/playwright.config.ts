import { defineConfig, devices } from '@playwright/test';

// PW_PORT=4391 runs on its own port, so two checkouts (or two people) don't share a server.
const port = Number(process.env.PW_PORT) || 4173;

// Smoke test against the built site served by `vite preview`.
export default defineConfig({
	testDir: 'tests',
	// deep links need the Worker's fallback: playwright.relay.config.ts
	testIgnore: 'deeplink.spec.ts',
	timeout: 30_000,
	use: {
		baseURL: `http://localhost:${port}`,
		...devices['Pixel 7'],
		// PW_TZ=Asia/Kolkata npx playwright test: the samples must look the same from anywhere.
		timezoneId: process.env.PW_TZ || 'America/Chicago'
	},
	webServer: {
		command: `npm run build && npx vite preview --port ${port} --strictPort`,
		url: `http://localhost:${port}`,
		reuseExistingServer: true,
		timeout: 120_000
	}
});
