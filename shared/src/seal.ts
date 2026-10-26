// AES-GCM sealing for circle entries. WebCrypto only, so it runs in the app, the Worker and tests.
// The family page (/c/:id) inlines the same steps; keep both in step.
import type { CircleEntry, Sealed } from './circle.ts';

export function b64url(bytes: Uint8Array): string {
	let s = '';
	for (const b of bytes) s += String.fromCharCode(b);
	return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function unb64url(text: string): Uint8Array<ArrayBuffer> {
	const s = atob(text.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((text.length + 3) % 4));
	return Uint8Array.from(s, (c) => c.charCodeAt(0));
}

/** A new 256-bit circle key, base64url. */
export function newCircleKey(): string {
	return b64url(crypto.getRandomValues(new Uint8Array(32)));
}
/** A random id of `n` base64url chars (16 for circles, 12 for members). */
export function randomId(n: number): string {
	return b64url(crypto.getRandomValues(new Uint8Array(Math.ceil((n * 3) / 4)))).slice(0, n);
}

async function importKey(key: string): Promise<CryptoKey> {
	return crypto.subtle.importKey('raw', unb64url(key), 'AES-GCM', false, ['encrypt', 'decrypt']);
}

/** Additional data binds a ciphertext to its circle and member, so entries can't be swapped. */
const aad = (circleId: string, memberId: string) => new TextEncoder().encode(`kizuna:${circleId}:${memberId}`);

export async function sealEntry(key: string, circleId: string, memberId: string, entry: CircleEntry): Promise<Sealed> {
	const iv = crypto.getRandomValues(new Uint8Array(12));
	const ct = await crypto.subtle.encrypt(
		{ name: 'AES-GCM', iv, additionalData: aad(circleId, memberId) },
		await importKey(key),
		new TextEncoder().encode(JSON.stringify(entry))
	);
	return { iv: b64url(iv), ct: b64url(new Uint8Array(ct)) };
}

/** Returns null if the entry can't be opened (wrong key, tampered, or not JSON). */
export async function openEntry(key: string, circleId: string, memberId: string, sealed: Sealed): Promise<CircleEntry | null> {
	try {
		const pt = await crypto.subtle.decrypt(
			{ name: 'AES-GCM', iv: unb64url(sealed.iv), additionalData: aad(circleId, memberId) },
			await importKey(key),
			unb64url(sealed.ct)
		);
		const entry = JSON.parse(new TextDecoder().decode(pt)) as CircleEntry;
		return entry && entry.v === 1 ? entry : null;
	} catch {
		return null;
	}
}
