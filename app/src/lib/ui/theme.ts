// Theme choice lives in localStorage so app.html can apply it before first paint.
export type ThemeChoice = 'system' | 'light' | 'dark';
const KEY = 'kizuna-theme';

export function getTheme(): ThemeChoice {
	try {
		const t = localStorage.getItem(KEY);
		return t === 'light' || t === 'dark' ? t : 'system';
	} catch {
		return 'system';
	}
}

export function setTheme(t: ThemeChoice): void {
	try {
		if (t === 'system') localStorage.removeItem(KEY);
		else localStorage.setItem(KEY, t);
	} catch {
		/* private mode: still apply for this visit */
	}
	const root = document.documentElement;
	if (t === 'system') delete root.dataset.theme;
	else root.dataset.theme = t;
	const dark = t === 'dark' || (t === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
	document.querySelectorAll('meta[name="theme-color"]').forEach((m) => {
		m.setAttribute('content', dark ? '#1c1916' : '#fbf8f3');
	});
}
