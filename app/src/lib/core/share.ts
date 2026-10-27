// Sharing a line the user sends themselves: the phone's share sheet when there is one (mobile),
// otherwise copy it and open WhatsApp, so it can be pasted into the family group.

/** 'blocked': the browser stopped the new tab (the tap no longer counted); nothing was sent. */
export type ShareResult = 'shared' | 'copied' | 'opened' | 'cancelled' | 'blocked';

export interface ShareDeps {
	share?: (data: { text: string }) => Promise<void>;
	copy?: (text: string) => Promise<void>;
	/** Returns false when the browser blocked it. */
	open: (url: string) => void | boolean;
}

/** wa.me with only the text: WhatsApp asks which chat (or group) to send it to. */
export function whatsappTextLink(text: string): string {
	return `https://wa.me/?text=${encodeURIComponent(text)}`;
}

/**
 * Pure (given its deps): share sheet first; if there is none or it fails, copy the line and open
 * wa.me. "cancelled" when the user closes the share sheet (nothing else happens then).
 */
export async function shareLine(text: string, deps: ShareDeps): Promise<ShareResult> {
	if (deps.share) {
		try {
			await deps.share({ text });
			return 'shared';
		} catch (e) {
			if ((e as { name?: string })?.name === 'AbortError') return 'cancelled';
			/* fall back below */
		}
	}
	// Start the copy while the tap still counts as a user gesture, then open WhatsApp.
	const copied = deps.copy ? deps.copy(text).then(() => true, () => false) : Promise.resolve(false);
	const opened = deps.open(whatsappTextLink(text)) !== false;
	const didCopy = await copied;
	if (!opened) return didCopy ? 'copied' : 'blocked';
	return didCopy ? 'copied' : 'opened';
}

/** The browser's own share, copy and open. `into`: a tab opened earlier, still on the tap (see openBlankTab). */
export function browserShareDeps(into?: Window | null): ShareDeps {
	const nav = typeof navigator !== 'undefined' ? navigator : undefined;
	const canShare = !!nav?.share && (!nav.canShare || nav.canShare({ text: 'x' }));
	return {
		share: canShare ? (d) => nav!.share(d) : undefined,
		copy: nav?.clipboard?.writeText ? (t) => nav!.clipboard.writeText(t) : undefined,
		open: (url) => {
			if (into && !into.closed) {
				into.location.href = url;
				return true;
			}
			const w = window.open(url, '_blank');
			if (!w) return false;
			try {
				w.opener = null;
			} catch {
				/* already elsewhere */
			}
			return true;
		}
	};
}

/**
 * Opens an empty tab right away, while the tap still counts, for a link that is only ready after a
 * network call (Safari blocks window.open after an await). Only where there is no share sheet.
 */
export function openBlankTab(): Window | null {
	if (typeof window === 'undefined') return null;
	try {
		const w = window.open('', '_blank');
		if (w) {
			w.opener = null;
			try {
				w.document.title = 'Kizuna';
				w.document.body.style.cssText = 'font: 17px system-ui, sans-serif; padding: 24px; color: #555';
				w.document.body.textContent = 'Opening WhatsApp…';
			} catch {
				/* fine */
			}
		}
		return w;
	} catch {
		return null;
	}
}

/** True when this browser has a share sheet for text (phones). */
export function hasShareSheet(): boolean {
	return !!browserShareDeps().share;
}

/** Shares a line from a tap in the app. */
export function shareText(text: string): Promise<ShareResult> {
	return shareLine(text, browserShareDeps());
}
