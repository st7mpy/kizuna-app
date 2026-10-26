// Turns a Dexie liveQuery into a reactive value. Call during component setup.
// `make` runs inside an effect, so anything reactive it reads (like a route param) re-subscribes.
import type { Observable } from 'dexie';

export function watch<T>(make: () => Observable<T>, initial: T) {
	let value = $state.raw(initial);
	let ready = $state(false);
	$effect(() => {
		const sub = make().subscribe({
			next: (v) => {
				value = v;
				ready = true;
			},
			error: (e) => {
				console.warn('Kizuna: live data', e);
				ready = true;
			}
		});
		return () => sub.unsubscribe();
	});
	return {
		get value() {
			return value;
		},
		get ready() {
			return ready;
		}
	};
}
