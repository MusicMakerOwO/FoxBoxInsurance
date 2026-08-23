import {SimpleEmoji} from "../Typings/DatabaseTypes.js";
import {LRUCache} from "../Utils/DataStructures/LRUCache.js";
import {Database} from "../Database.js";

const cache = new LRUCache<SimpleEmoji['id'], SimpleEmoji>(1_000);

export async function GetEmoji(id: SimpleEmoji['id']): Promise<SimpleEmoji | null> {
	id = BigInt(id);
	if (cache.has(id)) return cache.get(id)!;

	const dbEmoji = await Database.query(`SELECT * FROM Emojis WHERE id = ?`, [id]).then(x => x[0]) as SimpleEmoji | null;
	if (!dbEmoji) return null;

	cache.set(dbEmoji.id, dbEmoji);
	return dbEmoji;
}

/** Resolves many emojis in a single query for whatever isn't already cached. */
export async function GetEmojiBulk(ids: SimpleEmoji['id'][]): Promise<Map<SimpleEmoji['id'], SimpleEmoji | null>> {
	const result = new Map<SimpleEmoji['id'], SimpleEmoji | null>();
	const missing: SimpleEmoji['id'][] = [];

	for (const rawID of new Set(ids)) {
		const id = BigInt(rawID);
		if (cache.has(id)) result.set(id, cache.get(id)!);
		else missing.push(id);
	}

	if (missing.length > 0) {
		const rows = await Database.query(
			`SELECT * FROM Emojis WHERE id IN (${'?,'.repeat(missing.length - 1)}?)`,
			missing
		) as SimpleEmoji[];

		for (const row of rows) cache.set(row.id, row);
		for (const id of missing) result.set(id, cache.get(id) ?? null);
	}

	return result;
}