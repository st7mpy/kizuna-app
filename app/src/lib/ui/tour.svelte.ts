// The guided first run after "Try with a sample family": three soft hints in order.
// 1 = on the map ("See who's free"), 2 = the weekend card, 3 = "Send it". 0 = off.
import { readLocal, writeLocal } from '#lib/core/local.js';

export const tour = $state<{ step: number }>({ step: readLocal<number>('tour', 0) });

export function startTour(): void {
	tour.step = 1;
	writeLocal('tour', 1);
}

/** Moves past a step once its hint was tapped (later steps never go back). */
export function passTour(step: number): void {
	if (tour.step !== step) return;
	tour.step = step >= 3 ? 0 : step + 1;
	writeLocal('tour', tour.step);
}

export function endTour(): void {
	tour.step = 0;
	writeLocal('tour', 0);
}
