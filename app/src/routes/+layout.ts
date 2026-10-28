// Static single-page app: everything runs on the phone.

export const prerender = true;
export const ssr = false;

/**
 * `/?fresh`: clears Kizuna on this browser and opens the first screen, so each demo run starts clean.
 * Runs before any page renders. The theme choice is kept.
 */
export async function load({ url }: { url: URL }) {
	if (typeof window === 'undefined' || !url.searchParams.has('fresh')) return {};
	const [{ deleteEverything }, { clearEntered }, { endTour }] = await Promise.all([
		import('#lib/core/index.js'),
		import('#lib/landing/entered.js'),
		import('#lib/ui/tour.svelte.js')
	]);
	try {
		await deleteEverything();
	} catch {
		/* a reload below still starts the first screen */
	}
	clearEntered();
	endTour();
	try {
		sessionStorage.clear();
		// Every Kizuna key on this browser except the theme choice.
		for (const k of Object.keys(localStorage)) if (k.startsWith('kizuna') && k !== 'kizuna-theme') localStorage.removeItem(k);
	} catch {
		/* nothing stored */
	}
	location.replace('/');
	// Hold the page until the reload, so nothing old flashes.
	await new Promise(() => {});
	return {};
}
