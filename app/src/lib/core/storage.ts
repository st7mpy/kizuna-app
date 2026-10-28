// Keeping notes on the phone. Safari can clear a site's data after 7 days without a visit;
// asking for persistent storage (and, on iPhone, adding Kizuna to the Home Screen) stops that.
import { readLocal, writeLocal } from './local.ts';

/** Asks the browser once to keep Kizuna's data. Safe to call often; quiet when unsupported. */
export async function askPersist(): Promise<boolean> {
	try {
		const s = typeof navigator !== 'undefined' ? navigator.storage : undefined;
		if (!s?.persist) return false;
		if (s.persisted && (await s.persisted())) return true;
		if (readLocal('persistAsked', false)) return false;
		writeLocal('persistAsked', true);
		return await s.persist();
	} catch {
		return false;
	}
}

/** Pure: an iPhone or iPad browser tab (not the Home Screen app). */
export function isIosTab(ua: string, standalone: boolean, touchMac = false): boolean {
	const ios = /iPhone|iPad|iPod/.test(ua) || (touchMac && /Macintosh/.test(ua));
	return ios && !standalone;
}

/** True when the one-time "Add to Home Screen" hint should show. */
export function needsHomeScreenHint(): boolean {
	if (typeof navigator === 'undefined' || readLocal('homeHint', false)) return false;
	try {
		const standalone =
			(navigator as Navigator & { standalone?: boolean }).standalone === true || matchMedia('(display-mode: standalone)').matches;
		return isIosTab(navigator.userAgent, standalone, navigator.maxTouchPoints > 1);
	} catch {
		return false;
	}
}

export function dismissHomeScreenHint(): void {
	writeLocal('homeHint', true);
}
