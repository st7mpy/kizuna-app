import { describe, expect, it, vi } from 'vitest';
import { shareLine, whatsappTextLink } from './share.ts';

const LINE = 'Family call this weekend? Sunday at 1:00, everyone is free then.';

describe('sharing a line', () => {
	it('uses the share sheet when there is one, with the text only', async () => {
		const share = vi.fn(async () => {});
		const copy = vi.fn(async () => {});
		const open = vi.fn();
		expect(await shareLine(LINE, { share, copy, open })).toBe('shared');
		expect(share).toHaveBeenCalledWith({ text: LINE });
		expect(copy).not.toHaveBeenCalled();
		expect(open).not.toHaveBeenCalled();
	});

	it('closing the share sheet does nothing else', async () => {
		const open = vi.fn();
		const share = vi.fn(async () => {
			throw Object.assign(new Error('closed'), { name: 'AbortError' });
		});
		expect(await shareLine(LINE, { share, copy: vi.fn(async () => {}), open })).toBe('cancelled');
		expect(open).not.toHaveBeenCalled();
	});

	it('without a share sheet: copies the line and opens WhatsApp to pick the group', async () => {
		const copy = vi.fn(async () => {});
		const open = vi.fn();
		expect(await shareLine(LINE, { copy, open })).toBe('copied');
		expect(copy).toHaveBeenCalledWith(LINE);
		expect(open).toHaveBeenCalledWith(`https://wa.me/?text=${encodeURIComponent(LINE)}`);
		expect(whatsappTextLink('a b&c')).toBe('https://wa.me/?text=a%20b%26c');
	});

	it('a failing share sheet or clipboard still opens WhatsApp', async () => {
		const open = vi.fn();
		const share = vi.fn(async () => {
			throw new Error('not allowed');
		});
		const copy = vi.fn(async () => {
			throw new Error('denied');
		});
		expect(await shareLine(LINE, { share, copy, open })).toBe('opened');
		expect(open).toHaveBeenCalledTimes(1);
		expect(await shareLine(LINE, { open })).toBe('opened');
	});
});
