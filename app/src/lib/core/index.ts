// The app's core API. UI code imports only from here (and from '@kizuna/shared' for types).
import { processPending } from './capture.ts';
import { runWeave } from './weave.ts';

export { saveFragment, processPending, retryFragment } from './capture.ts';
export { runWeave } from './weave.ts';
export { getSettings, updateSettings, setRoom } from './settings.ts';
export { todayCards, answerCard } from './today.ts';
export { draftPoke, whatsappLink } from './poke.ts';
export { suggestSlots, createInvite, googleCalendarLink, icsFile } from './time.ts';
export { updatePerson, mergePeople, removePerson, updateThread, markReached } from './people.ts';
export { loadSampleLife } from './sample.ts';
export { deleteEverything, exportNotes } from './data.ts';
export { isOnline } from './relay.ts';

/** Call once when the app opens: understands notes left from before (and again when back online), then weaves if due. */
export function startCore(): void {
	void processPending()
		.then(() => runWeave())
		.catch(() => {});
}
