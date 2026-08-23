import {Asset} from "../Typings/DatabaseTypes.js";
import {LRUCache} from "../Utils/DataStructures/LRUCache.js";
import {Database} from "../Database.js";

const cache = new LRUCache<Asset['discord_id'], Asset>(2_000);

export async function GetAsset(id: Asset['discord_id']): Promise<Asset | null> {
	id = BigInt(id);
	if (cache.has(id)) return cache.get(id)!;

	const asset = await Database.query(`SELECT * FROM Assets WHERE discord_id = ?`, [id]).then(x => x[0]) as Asset | null;
	if (!asset) return null;

	cache.set(asset.discord_id, asset);
	return asset;
}

/** Resolves many assets in a single query for whatever isn't already cached. */
export async function GetAssetBulk(ids: Asset['discord_id'][]): Promise<Map<Asset['discord_id'], Asset | null>> {
	const result = new Map<Asset['discord_id'], Asset | null>();
	const missing: Asset['discord_id'][] = [];

	for (const rawID of new Set(ids)) {
		const id = BigInt(rawID);
		if (cache.has(id)) result.set(id, cache.get(id)!);
		else missing.push(id);
	}

	if (missing.length > 0) {
		const rows = await Database.query(
			`SELECT * FROM Assets WHERE discord_id IN (${'?,'.repeat(missing.length - 1)}?)`,
			missing
		) as Asset[];

		for (const row of rows) cache.set(row.discord_id, row);
		for (const id of missing) result.set(id, cache.get(id) ?? null);
	}

	return result;
}