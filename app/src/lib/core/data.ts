// The user's data: delete it all, or take the notes away as text.
import { db } from '../db.ts';
import { localDay, localTime } from './days.ts';
import { clearDeviceId } from './relay.ts';
import { clearAll } from './sample.ts';

export async function deleteEverything(): Promise<void> {
	await clearAll();
	clearDeviceId();
}

/** Pure: notes as Markdown, grouped by day, oldest first. */
export function notesMarkdown(notes: { text: string; createdAt: string }[]): string {
	const sorted = [...notes].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
	const lines = ['# Kizuna notes', ''];
	let day = '';
	for (const n of sorted) {
		const d = localDay(n.createdAt);
		if (d !== day) {
			if (day) lines.push('');
			day = d;
			lines.push(`## ${d}`, '');
		}
		lines.push(`- ${localTime(n.createdAt)} ${n.text.replace(/\s*\n\s*/g, ' ')}`);
	}
	return lines.join('\n') + '\n';
}

export async function exportNotes(): Promise<Blob> {
	return new Blob([notesMarkdown(await db.fragments.toArray())], { type: 'text/markdown;charset=utf-8' });
}
