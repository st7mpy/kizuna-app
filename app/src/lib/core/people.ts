// Finding, creating and merging people. Names are matched case-insensitively, by alias,
// and by kinship words (Ma / Maa / Mummy / Mum are one parent).
import type { Person, Relation, Thread } from '@kizuna/shared';
import { db, newId } from '../db.ts';

const KIN_GROUPS: string[][] = [
	['ma', 'maa', 'mum', 'mummy', 'mumma', 'mom', 'mommy', 'mother', 'amma', 'ammi', 'mamma', 'aai'],
	['papa', 'pappa', 'dad', 'daddy', 'father', 'pitaji', 'abba', 'baba', 'appa']
];
const PARENTISH: Relation[] = ['parent', 'unknown', 'family'];

/** Lower-case, trimmed, without a trailing "ji". */
export function normName(name: string): string {
	return name
		.toLowerCase()
		.normalize('NFKC')
		.replace(/[.,!?"']/g, '')
		.replace(/[\s-]+ji$/, '')
		.replace(/\s+/g, ' ')
		.trim();
}

export function kinGroup(name: string): string[] | null {
	const n = normName(name);
	return KIN_GROUPS.find((g) => g.includes(n)) ?? null;
}

function namesOf(p: Person): string[] {
	return [normName(p.name), ...p.aliases.map(normName)];
}

/** Pure: which of `people` is this name? */
export function matchPerson(people: Person[], name: string, relation: Relation = 'unknown'): Person | undefined {
	const n = normName(name);
	if (!n) return undefined;
	const exact = people.find((p) => namesOf(p).includes(n));
	if (exact) return exact;
	const group = kinGroup(n);
	if (group && PARENTISH.includes(relation)) {
		return people.find((p) => PARENTISH.includes(p.relation) && namesOf(p).some((x) => group.includes(x)));
	}
	return undefined;
}

function displayName(name: string): string {
	const t = name.trim().replace(/\s+/g, ' ');
	return t ? t[0].toUpperCase() + t.slice(1) : t;
}

export function unionAliases(...lists: (string[] | undefined)[]): string[] {
	const out = new Set<string>();
	for (const l of lists) for (const a of l ?? []) if (normName(a)) out.add(normName(a));
	return [...out];
}

/**
 * Finds or creates a person in the given in-memory list (also writes to the db).
 * Call inside a transaction covering db.people.
 */
export async function upsertPerson(
	people: Person[],
	name: string,
	relation: Relation,
	createdAt: string,
	extraAliases: string[] = []
): Promise<Person> {
	let p = matchPerson(people, name, relation);
	if (!p) for (const a of extraAliases) if ((p = matchPerson(people, a, relation))) break;
	if (p) {
		const aliases = unionAliases(p.aliases, [name], extraAliases);
		const better = p.relation === 'unknown' && relation !== 'unknown' ? relation : p.relation;
		if (aliases.length !== p.aliases.length || better !== p.relation) {
			p.aliases = aliases;
			p.relation = better;
			await db.people.put(p);
		}
		return p;
	}
	const created: Person = {
		id: newId(),
		name: displayName(name),
		aliases: unionAliases([name], extraAliases),
		relation,
		circle: 'none',
		mentions: 0,
		createdAt
	};
	people.push(created);
	await db.people.add(created);
	return created;
}

const swap = (ids: string[], from: string, to: string) => [...new Set(ids.map((x) => (x === from ? to : x)))];
const later = (a?: string, b?: string) => (!a ? b : !b ? a : a > b ? a : b);

/** Same person under two records: keep one, move everything from the other. */
export async function mergePeople(keepId: string, dropId: string): Promise<void> {
	if (keepId === dropId) return;
	await db.transaction('rw', [db.people, db.events, db.threads, db.fragments, db.prompts], async () => {
		const [keep, drop] = await Promise.all([db.people.get(keepId), db.people.get(dropId)]);
		if (!keep || !drop) return;
		const circleRank = { in: 3, out: 2, suggested: 1, none: 0 } as const;
		await db.people.put({
			...keep,
			aliases: unionAliases(keep.aliases, drop.aliases, [drop.name]),
			relation: keep.relation === 'unknown' ? drop.relation : keep.relation,
			phone: keep.phone ?? drop.phone,
			circle: circleRank[drop.circle] > circleRank[keep.circle] ? drop.circle : keep.circle,
			summary: keep.summary ?? drop.summary,
			why: keep.why ?? drop.why,
			mentions: keep.mentions + drop.mentions,
			lastMentionedAt: later(keep.lastMentionedAt, drop.lastMentionedAt),
			lastReachedAt: later(keep.lastReachedAt, drop.lastReachedAt),
			createdAt: keep.createdAt < drop.createdAt ? keep.createdAt : drop.createdAt
		});
		await db.events.where('personIds').equals(dropId).modify((e) => {
			e.personIds = swap(e.personIds, dropId, keepId);
		});
		await db.threads.where('personIds').equals(dropId).modify((t) => {
			t.personIds = swap(t.personIds, dropId, keepId);
		});
		await db.fragments.where('personIds').equals(dropId).modify((f) => {
			f.personIds = swap(f.personIds ?? [], dropId, keepId);
		});
		await db.prompts.where('personId').equals(dropId).modify((p) => {
			p.personId = keepId;
		});
		await db.people.delete(dropId);
	});
}

export async function updatePerson(id: string, patch: Partial<Person>): Promise<void> {
	const { id: _ignored, ...rest } = patch;
	if (rest.aliases) rest.aliases = unionAliases(rest.aliases);
	if (rest.phone !== undefined) rest.phone = rest.phone.replace(/\D/g, '') || undefined;
	await db.people.update(id, rest);
}

/** Forget a person. Their notes stay; events only about them go. */
export async function removePerson(id: string): Promise<void> {
	await db.transaction('rw', [db.people, db.events, db.threads, db.fragments, db.prompts], async () => {
		const without = (ids: string[]) => ids.filter((x) => x !== id);
		await db.events.where('personIds').equals(id).modify((e, ref) => {
			e.personIds = without(e.personIds);
			if (!e.personIds.length) delete (ref as { value?: unknown }).value;
		});
		await db.threads.where('personIds').equals(id).modify((t) => {
			t.personIds = without(t.personIds);
		});
		await db.fragments.where('personIds').equals(id).modify((f) => {
			f.personIds = without(f.personIds ?? []);
		});
		await db.prompts.where('personId').equals(id).delete();
		await db.people.delete(id);
	});
}

export async function updateThread(id: string, patch: Partial<Thread>): Promise<void> {
	const { id: _ignored, ...rest } = patch;
	await db.threads.update(id, { ...rest, updatedAt: new Date().toISOString() });
}

/** Called when the user taps Send on a poke. Never shown as a counter. */
export async function markReached(personId: string): Promise<void> {
	await db.people.update(personId, { lastReachedAt: new Date().toISOString() });
}
