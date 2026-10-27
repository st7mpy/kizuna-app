// One small message at a time at the bottom of the screen ("Copied. Paste it in your family group").
import { browserShareDeps, hasShareSheet, openBlankTab, shareLine, shareText, type ShareResult } from '#lib/core/index.js';

export interface ToastAction {
	label: string;
	run: () => void | Promise<void>;
}

export const toast = $state<{ text: string; id: number; action: ToastAction | null }>({ text: '', id: 0, action: null });

let timer: ReturnType<typeof setTimeout> | undefined;
/** Shows a short message; with an action (like Undo) it stays a little longer. */
export function say(text: string, ms = 4000, action: ToastAction | null = null): void {
	toast.text = text;
	toast.action = action;
	toast.id++;
	clearTimeout(timer);
	timer = setTimeout(hush, action ? Math.max(ms, 6000) : ms);
}

export function hush(): void {
	clearTimeout(timer);
	toast.text = '';
	toast.action = null;
}

/** Shares a line the user sends themselves; when it was copied instead, says where to paste it. */
export async function shareWithToast(text: string, where = 'your family group'): Promise<ShareResult> {
	const r = await shareText(text);
	if (r === 'copied') say(`Copied. Paste it in ${where}`);
	return r;
}

/**
 * Shares a line that first needs a network call (e.g. making the family link). Where there is no
 * share sheet, a tab opens at once on the tap and goes to WhatsApp when the line is ready, so
 * Safari doesn't block it. Where the share sheet no longer opens after the wait, returns 'blocked'
 * and the caller offers one more tap (the line is ready by then, so that tap shares at once).
 */
export async function shareAfter(make: () => Promise<string>, where = 'your family group'): Promise<ShareResult> {
	const tab = hasShareSheet() ? null : openBlankTab();
	let text: string;
	try {
		text = await make();
	} catch (e) {
		tab?.close();
		throw e;
	}
	let r: ShareResult;
	try {
		r = await shareLine(text, browserShareDeps(tab));
	} catch {
		r = 'blocked';
	}
	if (r === 'copied') say(`Copied. Paste it in ${where}`);
	return r;
}
