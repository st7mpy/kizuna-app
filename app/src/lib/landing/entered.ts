// Remembers, on this device, that someone has stepped past the landing page into the app,
// so "/" stops showing the landing to them even before they have saved a note.
const KEY = 'kizuna-entered';

export function hasEntered(): boolean {
	try {
		return localStorage.getItem(KEY) === '1';
	} catch {
		return false;
	}
}

export function markEntered(): void {
	try {
		localStorage.setItem(KEY, '1');
	} catch {
		/* private mode: they'll see the landing again next time, which is fine */
	}
}

export function clearEntered(): void {
	try {
		localStorage.removeItem(KEY);
	} catch {
		/* nothing to clear */
	}
}
