// The few Node APIs the push test uses to play the browser's side (tests run in Node).
declare module 'node:crypto' {
	export function createECDH(curve: string): any;
	export function createHash(alg: string): any;
	export function randomBytes(n: number): any;
}
declare const Buffer: { from(data: Uint8Array): any };
