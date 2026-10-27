// One small message at a time at the bottom of the screen ("Copied. Paste it in your family group").
import { shareText, type ShareResult } from '#lib/core/index.js';

export const toast = $state({ text: '', id: 0 });

let timer: ReturnType<typeof setTimeout> | undefined;
export function say(text: string, ms = 4000): void {
	toast.text = text;
	toast.id++;
	clearTimeout(timer);
	timer = setTimeout(() => (toast.text = ''), ms);
}

/** Shares a line the user sends themselves; when it was copied instead, says where to paste it. */
export async function shareWithToast(text: string, where = 'your family group'): Promise<ShareResult> {
	const r = await shareText(text);
	if (r === 'copied') say(`Copied. Paste it in ${where}`);
	return r;
}
