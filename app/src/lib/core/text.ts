// Small text helpers shared by the brief and by thread merging.

const SMALL = new Set(['a', 'an', 'the', 'for', 'of', 'on', 'in', 'to', 'and', 'with', 'at', 'his', 'her', 'their', 'my', 's']);
export function words(text: string): Set<string> {
	const plain = text.toLowerCase().replace(/\([^)]*\)/g, ' ').replace(/[^a-z0-9]+/g, ' ');
	return new Set(plain.split(' ').filter((w) => w && !SMALL.has(w)));
}

/** Pure: true when two lines say much the same thing ("Dad's 60th birthday" and "Family dinner for Dad's 60th"). */
export function similar(a: string, b: string): boolean {
	const x = words(a);
	const y = words(b);
	if (!x.size || !y.size) return false;
	let shared = 0;
	for (const w of x) if (y.has(w)) shared++;
	return shared / Math.min(x.size, y.size) >= 0.6;
}

/** Pure: true when two thread titles name the same thing ("Call Leo before exams", "Call Leo before his exams"). */
export function sameTitle(a: string, b: string): boolean {
	const x = words(a);
	const y = words(b);
	if (!x.size || !y.size) return false;
	let shared = 0;
	for (const w of x) if (y.has(w)) shared++;
	return shared / (x.size + y.size - shared) >= 0.8;
}
