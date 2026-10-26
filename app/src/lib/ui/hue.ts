// A soft colour per person, so a list reads at a glance without photos.
// Picked from the id, so it stays the same across renames and devices.
export const HUES = [
	'#f4c46c', // amber
	'#f39b80', // coral
	'#b6a4f4', // lavender
	'#d6e38a', // lime
	'#9cc6ee', // sky
	'#f1a9c4', // rose
	'#9fd9bf', // mint
	'#e3cba2' // sand
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
