// A soft colour per person, so a list reads at a glance without photos.
// On the map each person gets their own colour (core/map.ts assignHues); otherwise it comes from the id.
import { mapHueIndex } from '../core/map.ts';
// Dawn-toned and a little pearly, so they sit softly on warm ivory and on charcoal.
export const HUES = [
	'#ecc489', // honey
	'#eba596', // coral
	'#bcb2e6', // lilac
	'#cbd49e', // sage
	'#a4c6e8', // sky
	'#e8b2c8', // rose
	'#a9d6c6', // mint
	'#e3cbab' // sand
] as const;

export function hueFor(id: string | undefined | null): string {
	if (!id) return HUES[7];
	// People on the map get one colour each (no repeats); everywhere else matches it.
	const given = mapHueIndex(id);
	if (given != null) return HUES[given % HUES.length];
	let h = 2166136261;
	for (let i = 0; i < id.length; i++) {
		h ^= id.charCodeAt(i);
		h = Math.imul(h, 16777619);
	}
	return HUES[(h >>> 0) % HUES.length];
}

/** The colour for a person on the map: their assigned one when the map gave one, else from the id. */
export function hueOf(p: { person: { id: string }; hue?: number | null }): string {
	return p.hue != null ? HUES[p.hue % HUES.length] : hueFor(p.person.id);
}
