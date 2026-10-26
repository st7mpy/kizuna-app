import type { Room, Settings } from '@kizuna/shared';
import { db, readSettings } from '../db.ts';
import { localDay } from './days.ts';

export async function getSettings(): Promise<Settings> {
	return readSettings();
}

export async function updateSettings(patch: Partial<Settings>): Promise<void> {
	await db.transaction('rw', db.settings, async () => {
		const cur = await readSettings();
		await db.settings.put({ ...cur, ...patch, id: 'me' });
	});
}

/** Today's room tap. */
export async function setRoom(level: Room): Promise<void> {
	await updateSettings({ room: { day: localDay(), level } });
}

/** Room for today; 'some' until the user taps. */
export function roomToday(s: Settings, now = new Date()): Room {
	return s.room && s.room.day === localDay(now) ? s.room.level : 'some';
}
