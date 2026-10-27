// Which layout the window is in, so a page can render a side column only when there is room.
// Matches the CSS breakpoints in app.css: rail from 720 px, two panes from 1100 px.
export const RAIL_MIN = 720;
export const WIDE_MIN = 1100;

export const screen = $state({ rail: false, wide: false });

if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
	const rail = window.matchMedia(`(min-width: ${RAIL_MIN}px)`);
	const wide = window.matchMedia(`(min-width: ${WIDE_MIN}px)`);
	const sync = () => {
		screen.rail = rail.matches;
		screen.wide = wide.matches;
	};
	sync();
	rail.addEventListener('change', sync);
	wide.addEventListener('change', sync);
}
