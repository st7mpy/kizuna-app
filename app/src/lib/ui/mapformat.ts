// Words for the map, the weekend card and the gift card. Plain, short, never counters.

/** "Sunday 11:00" in the phone's zone (or a given one). */
export function whenLocal(iso: string, timeZone?: string): string {
	const d = new Date(iso);
	const weekday = d.toLocaleDateString('en-GB', { weekday: 'long', timeZone });
	const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone });
	return `${weekday} ${time}`;
}

/** "Mum, Papa and Riya" */
export function andList(names: string[]): string {
	if (names.length <= 1) return names[0] ?? '';
	return `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}

const TOOL_WORDS: Record<string, string> = {
	get_windows: 'windows',
	get_occasions: 'occasions',
	get_local_time: 'local times',
	get_reasons: 'your notes'
};

/** "checked windows · occasions · local times" from the tools the planner used. */
export function traceLine(tools: string[]): string {
	const words = [...new Set(tools.map((t) => TOOL_WORDS[t]).filter(Boolean))];
	return words.length ? `checked ${words.join(' · ')}` : '';
}

/** "in 9 days", "tomorrow", "today": a date, not a score. */
export function inDays(n: number): string {
	if (n <= 0) return 'today';
	if (n === 1) return 'tomorrow';
	return `in ${n} days`;
}

/** "Papa's birthday is in 9 days." */
export function giftLead(occasionName: string, daysLeft: number): string {
	return `${occasionName} is ${inDays(daysLeft)}.`;
}

/** "Diwali · Sun 8 Nov" */
export function occasionChip(name: string, day: string): string {
	const [y, m, d] = day.split('-').map(Number);
	const date = new Date(y, m - 1, d).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
	return `${name} · ${date.replace(',', '')}`;
}

/** "Kabir: It's 00:30 in Toronto then." Adds the name when the reason starts without it. */
export function skippedLine(name: string, why: string): string {
	const w = why.trim().replace(/[.\s]+$/, '');
	if (!w) return '';
	const line = w.toLowerCase().startsWith(name.toLowerCase()) ? w : `${name}: ${w}`;
	return `${line}.`;
}


/** "KB" from "Kabir Bhatia", "M" from "Mum": initials for a round avatar. */
export function initials(name: string): string {
	const words = name.trim().split(/\s+/).filter(Boolean);
	if (!words.length) return '·';
	const first = [...words[0]][0] ?? '';
	const last = words.length > 1 ? ([...words[words.length - 1]][0] ?? '') : '';
	return (first + last).toUpperCase();
}

/** One status line under a name in the member list. Never a count, never a place. */
export function memberStatus(
	p: { localTime: string | null; tz: string | null; daylight: number; glow: 'open' | 'maybe' | null },
	city: (tz: string | null) => string
): { text: string; tone: 'open' | 'maybe' | 'night' | 'plain' | 'none' } {
	if (!p.localTime) return { text: 'Nothing shared', tone: 'none' };
	const place = city(p.tz);
	const clock = place ? `${p.localTime} ${place}` : p.localTime;
	if (p.glow === 'open') return { text: `Open to a call · ${clock}`, tone: 'open' };
	if (p.glow === 'maybe') return { text: `Maybe later · ${clock}`, tone: 'maybe' };
	if (p.daylight <= 0) return { text: `Night there · ${clock}`, tone: 'night' };
	return { text: clock, tone: 'plain' };
}
