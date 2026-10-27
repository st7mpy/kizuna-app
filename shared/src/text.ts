// Free text from the model. It sometimes writes the word "null" (or "none") instead of a JSON null.

const NULL_WORDS = /^(null|none|nil|undefined|n\/a|na|-|—)$/i;

/** Trimmed text, or null when it is blank or a stand-in for "nothing". */
export function modelText(v: unknown, max = 200): string | null {
	if (typeof v !== 'string') return null;
	const t = v.replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
	if (!t || NULL_WORDS.test(t.replace(/^["'.\s]+|["'.\s]+$/g, ''))) return null;
	return t.slice(0, max);
}
