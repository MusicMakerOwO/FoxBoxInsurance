import {SimpleSticker} from "../Typings/DatabaseTypes.js";
import {LRUCache} from "../Utils/DataStructures/LRUCache.js";
import {Database} from "../Database.js";

const cache = new LRUCache<SimpleSticker['id'], SimpleSticker>(500);

export async function GetSticker(id: SimpleSticker['id']): Promise<SimpleSticker | null> {
	id = BigInt(id);
	if (cache.has(id)) return cache.get(id)!;

	const dbSticker = await Database.query(`SELECT * FROM Stickers WHERE id = ?`, [id]).then(x => x[0]) as SimpleSticker | null;
	if (!dbSticker) return null;

	cache.set(dbSticker.id, dbSticker);
	return dbSticker;
}

/** Resolves many stickers in a single query for whatever isn't already cached. */
export async function GetStickerBulk(ids: SimpleSticker['id'][]): Promise<Map<SimpleSticker['id'], SimpleSticker | null>> {
	const result = new Map<SimpleSticker['id'], SimpleSticker | null>();
	const missing: SimpleSticker['id'][] = [];

	for (const rawID of new Set(ids)) {
		const id = BigInt(rawID);
		if (cache.has(id)) result.set(id, cache.get(id)!);
		else missing.push(id);
	}

	if (missing.length > 0) {
		const rows = await Database.query(
			`SELECT * FROM Stickers WHERE id IN (${'?,'.repeat(missing.length - 1)}?)`,
			missing
		) as SimpleSticker[];

		for (const row of rows) cache.set(row.id, row);
		for (const id of missing) result.set(id, cache.get(id) ?? null);
	}

	return result;
}