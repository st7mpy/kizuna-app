import { defineConfig } from 'vitest/config';
import adapter from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';

export default defineConfig({
	plugins: [
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},
			adapter: adapter({ fallback: '200.html' })
		})
	],
	// In dev the relay (wrangler dev) serves the API and pick-a-time pages.
	server: {
		proxy: {
			'/api': { target: 'http://localhost:8787', ws: true, changeOrigin: true },
			'/p': { target: 'http://localhost:8787', changeOrigin: true },
			'^/c/': { target: 'http://localhost:8787', changeOrigin: true }
		}
	},
	preview: {
		proxy: {
			'/api': { target: 'http://localhost:8787', ws: true, changeOrigin: true },
			'/p': { target: 'http://localhost:8787', changeOrigin: true },
			'^/c/': { target: 'http://localhost:8787', changeOrigin: true }
		}
	},
	test: {
		expect: { requireAssertions: true },
		projects: [
			{
				extends: './vite.config.ts',
				test: {
					name: 'server',
					environment: 'node',
					include: ['src/**/*.{test,spec}.{js,ts}'],
					exclude: ['src/**/*.svelte.{test,spec}.{js,ts}']
				}
			}
		]
	}
});
