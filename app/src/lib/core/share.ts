// Sharing a line the user sends themselves: the phone's share sheet when there is one (mobile),
// otherwise copy it and open WhatsApp, so it can be pasted into the family group.

export type ShareResult = 'shared' | 'copied' | 'opened' | 'cancelled';

export interface ShareDeps {
	share?: (data: { text: string }) => Promise<void>;
	copy?: (text: string) => Promise<void>;
	open: (url: string) => void;
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
	deps.open(whatsappTextLink(text));
	return (await copied) ? 'copied' : 'opened';
}

/** The browser's own share, copy and open. */
export function browserShareDeps(): ShareDeps {
	const nav = typeof navigator !== 'undefined' ? navigator : undefined;
	const canShare = !!nav?.share && (!nav.canShare || nav.canShare({ text: 'x' }));
	return {
		share: canShare ? (d) => nav!.share(d) : undefined,
		copy: nav?.clipboard?.writeText ? (t) => nav!.clipboard.writeText(t) : undefined,
		open: (url) => void window.open(url, '_blank', 'noopener')
	};
}

/** Shares a line from a tap in the app. */
export function shareText(text: string): Promise<ShareResult> {
	return shareLine(text, browserShareDeps());
}
