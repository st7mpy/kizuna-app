import { describe, expect, it } from 'vitest';
import { modelText } from './text.ts';

describe('modelText', () => {
	it.each([['null'], ['NULL'], [' none '], ['"null"'], [''], ['   '], ['N/A'], [null], [undefined], [3]])('treats %j as nothing', (v) => {
		expect(modelText(v)).toBeNull();
	});
	it('keeps real text, trimmed and capped', () => {
		expect(modelText('  Only Saturday works.  ')).toBe('Only Saturday works.');
		expect(modelText('Nothing fits', 7)).toBe('Nothing');
		expect(modelText('None of these are mornings.')).toBe('None of these are mornings.');
	});
});
