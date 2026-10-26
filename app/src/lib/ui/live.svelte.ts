// Turns a Dexie liveQuery into a reactive value. Call during component setup.
// `make` runs inside an effect, so anything reactive it reads (like a route param) re-subscribes.
/** Anything with a Dexie-style subscribe (liveQuery, or the map's own live view). */
interface Live<T> {
	subscribe(o: { next: (v: T) => void; error?: (e: unknown) => void }): { unsubscribe(): void };
}

export function watch<T>(make: () => Live<T>, initial: T) {
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
