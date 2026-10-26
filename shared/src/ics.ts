// Calendar files (.ics, RFC 5545) and Google Calendar template links, used by the app and the relay.

/** 'YYYYMMDDTHHMMSSZ' */
export function utcStamp(d: Date | string | number): string {
	return new Date(d).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/** Escapes a TEXT value: backslash, semicolon, comma and newlines. */
export function icsEscape(s: string): string {
	return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r\n|\r|\n/g, '\\n');
}

/** Folds lines longer than 75 octets, never splitting a character. */
export function icsFold(line: string): string {
	const enc = new TextEncoder();
	if (enc.encode(line).length <= 75) return line;
	const parts: string[] = [];
	let cur = '';
	let size = 0;
	for (const ch of line) {
		const n = enc.encode(ch).length;
		if (size + n > (parts.length ? 74 : 75)) {
			parts.push(cur);
			cur = '';
			size = 0;
		}
		cur += ch;
		size += n;
	}
	parts.push(cur);
	return parts.join('\r\n ');
}

export interface IcsEvent {
	uid: string;
	start: string | Date;
	end: string | Date;
	title: string;
	description?: string;
	now?: number;
}

/** One-event calendar file with CRLF line ends. */
export function icsText(ev: IcsEvent): string {
	const lines = [
		'BEGIN:VCALENDAR',
		'VERSION:2.0',
		'PRODID:-//Kizuna//Kizuna//EN',
		'CALSCALE:GREGORIAN',
		'METHOD:PUBLISH',
		'BEGIN:VEVENT',
		`UID:${ev.uid}`,
		`DTSTAMP:${utcStamp(ev.now ?? Date.now())}`,
		`DTSTART:${utcStamp(ev.start)}`,
		`DTEND:${utcStamp(ev.end)}`,
		`SUMMARY:${icsEscape(ev.title)}`,
		...(ev.description ? [`DESCRIPTION:${icsEscape(ev.description)}`] : []),
		'END:VEVENT',
		'END:VCALENDAR'
	];
	return lines.map(icsFold).join('\r\n') + '\r\n';
}

export function googleCalendarLink(slot: { start: string; end: string }, title: string, details?: string): string {
	const p = new URLSearchParams({ action: 'TEMPLATE', text: title, dates: `${utcStamp(slot.start)}/${utcStamp(slot.end)}` });
	if (details) p.set('details', details);
	return `https://calendar.google.com/calendar/render?${p.toString()}`;
}
