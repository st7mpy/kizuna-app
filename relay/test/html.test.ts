import { describe, expect, it } from 'vitest';
import { escapeHtml, readCapped } from '../src/http.ts';

describe('escapeHtml', () => {
	it('escapes the five characters', () => {
		expect(escapeHtml(`<a href="x" onclick='y'>&</a>`)).toBe('&lt;a href=&quot;x&quot; onclick=&#39;y&#39;&gt;&amp;&lt;/a&gt;');
	});
	it('handles non-strings', () => {
		expect(escapeHtml(null)).toBe('');
		expect(escapeHtml(42)).toBe('42');
	});
});

describe('readCapped', () => {
	it('stops reading past the cap', async () => {
		const body = new Response('x'.repeat(100)).body;
		expect(await readCapped(body, 50)).toBeNull();
		expect((await readCapped(new Response('hello').body, 50))!.byteLength).toBe(5);
	});
});
