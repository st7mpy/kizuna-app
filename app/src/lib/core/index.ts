// The app's core API. UI code imports only from here (and from '@kizuna/shared' for types).
import { processPending, requeueFailed } from './capture.ts';
import { runWeave } from './weave.ts';
import { startPickPolling } from './picks.ts';
import { entrySignature, publishMyEntry, refreshCircle } from './circle.ts';
import { liveQuery } from 'dexie';
import { readSettings } from '../db.ts';
import { refreshStaleSample } from './sample.ts';

export { saveFragment, processPending, retryFragment, noteThought } from './capture.ts';
export { runWeave, onWeaveBuilding } from './weave.ts';
export { getSettings, updateSettings, setRoom } from './settings.ts';
export { todayCards, answerCard, answeredToday, todayExtras, type TodayExtras } from './today.ts';
export {
	createCircle,
	circleLink,
	newCircleLink,
	myWindows,
	publishMyEntry,
	refreshCircle,
	linkMember,
	addMemberAsPerson,
	leaveCircle,
	setSharing,
	SAMPLE_CIRCLE_ID
} from './circle.ts';
export { FESTIVALS, upcomingOccasions, daysUntil } from './occasions.ts';
export { buildMapView, isSharing, MAP_MAX_PEOPLE, type MapView, type MapPerson } from './map.ts';
export {
	weekendCard,
	planWeekend,
	answerWeekend,
	draftForGroup,
	draftForPerson,
	WHATSAPP_SCHEDULE_TIP
} from './weekend.ts';
export { giftCards, draftGiftLine, markGift } from './gifts.ts';
export { inviteFamilyLine, invitePersonLine } from './invite.ts';
export {
	answerLines,
	dismissAnswer,
	followUps,
	draftNudge,
	markNudged,
	markInvited,
	freshAnswerPeople,
	type AnswerLine,
	type FollowUp
} from './answers.ts';
export { shareText, shareLine, browserShareDeps, openBlankTab, hasShareSheet, type ShareResult } from './share.ts';
export { draftPoke, templateLine, whatsappLink, type PokeDraft } from './poke.ts';
export { suggestSlots, createInvite, googleCalendarLink, icsFile, checkCalendar, isCalendarLink, clearBusyCache } from './time.ts';
export { updatePerson, mergePeople, removePerson, updateThread, markReached } from './people.ts';
export { loadSampleLife, loadSample, refreshSampleMembers, SAMPLES, type SampleKey } from './sample.ts';
export { deleteEverything, exportNotes } from './data.ts';
export { isOnline } from './relay.ts';
export { picksToday, closePick, checkInvites, type PickedLine } from './picks.ts';

/** Call once when the app opens: understands notes left from before (and again when back online), then weaves if due. */
export function startCore(): void {
	askPersistentStorage();
	// A visitor who only ever looked at an older sample gets the current one, quietly.
	void refreshStaleSample()
		.catch(() => false)
		.then(() => requeueFailed())
		.then(() => processPending())
		.then(() => runWeave())
		.catch(() => {});
	startCircleSync();
	startPickPolling();
}

let syncing = false;
/** The map stays fresh: fetch on open and every 60 s while visible; republish when my settings or room change. */
function startCircleSync(): void {
	if (syncing || typeof window === 'undefined') return;
	syncing = true;
	const visible = () => typeof document === 'undefined' || document.visibilityState !== 'hidden';
	const refresh = () => {
		if (visible()) void refreshCircle().catch(() => {});
	};
	refresh();
	setInterval(refresh, 60_000);
	document.addEventListener?.('visibilitychange', refresh);
	window.addEventListener('online', refresh);

	let last: string | null = null;
	let timer: ReturnType<typeof setTimeout> | undefined;
	liveQuery(readSettings).subscribe({
		next: (s) => {
			const sig = entrySignature(s);
			if (sig === last) return;
			const first = last === null;
			last = sig;
			clearTimeout(timer);
			// on open, and after a change settles
			timer = setTimeout(() => void publishMyEntry().catch(() => {}), first ? 0 : 1500);
		},
		error: () => {}
	});
}

let persistAsked = false;
/** Asks the browser not to clear our storage (Safari drops it after 7 idle days otherwise). */
function askPersistentStorage(): void {
	if (persistAsked) return;
	persistAsked = true;
	try {
		void navigator?.storage?.persist?.().catch(() => {});
	} catch {
		/* not supported */
	}
}
