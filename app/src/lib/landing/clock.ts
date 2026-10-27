// Local time in a city, for the landing page's live map. 24-hour "HH:MM".
export function timeIn(tz: string, at: Date = new Date()): string {
	try {
		return new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).format(at);
	} catch {
		return '';
	}
}

/** 0 at night, 1 in full daylight, with an hour of dusk and dawn. Matches the map's moon-phase shade. */
export function daylightIn(tz: string, at: Date = new Date()): number {
	const t = timeIn(tz, at);
	if (!t) return 1;
	const [h, m] = t.split(':').map(Number);
	const x = h + m / 60;
	if (x >= 7 && x < 18) return 1;
	if (x >= 6 && x < 7) return x - 6;
	if (x >= 18 && x < 19) return 19 - x;
	return 0;
}
