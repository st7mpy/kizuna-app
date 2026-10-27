// A soft colour per person, so a list reads at a glance without photos.
// Picked from the id, so it stays the same across renames and devices.
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
	let h = 2166136261;
	for (let i = 0; i < id.length; i++) {
		h ^= id.charCodeAt(i);
		h = Math.imul(h, 16777619);
	}
	return HUES[(h >>> 0) % HUES.length];
}
