import { defineConfig, devices } from '@playwright/test';

// Smoke test against the built site served by `vite preview`.
export default defineConfig({
	testDir: 'tests',
	timeout: 30_000,
	use: {
		baseURL: 'http://localhost:4173',
		...devices['Pixel 7'],
		// PW_TZ=Asia/Kolkata npx playwright test: the samples must look the same from anywhere.
		timezoneId: process.env.PW_TZ || 'America/Chicago'
	},
	webServer: {
		command: 'npm run build && npx vite preview --port 4173 --strictPort',
		url: 'http://localhost:4173',
		reuseExistingServer: true,
		timeout: 120_000
	}
});
