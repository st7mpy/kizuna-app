import { defineConfig, devices } from '@playwright/test';

// Smoke test against the built site served by `vite preview`.
export default defineConfig({
	testDir: 'tests',
	timeout: 30_000,
	use: {
		baseURL: 'http://localhost:4173',
		...devices['Pixel 7'],
		timezoneId: 'Asia/Kolkata'
	},
	webServer: {
		command: 'npm run build && npx vite preview --port 4173 --strictPort',
		url: 'http://localhost:4173',
		reuseExistingServer: true,
		timeout: 120_000
	}
});
