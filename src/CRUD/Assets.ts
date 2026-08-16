import {Asset} from "../Typings/DatabaseTypes.js";
import {LRUCache} from "../Utils/DataStructures/LRUCache.js";
import {Database} from "../Database.js";

const cache = new LRUCache<Asset['discord_id'], Asset>(2_000);

export async function GetAsset(id: Asset['discord_id']): Promise<Asset | null> {
	id = BigInt(id);
	if (cache.has(id)) return cache.get(id)!;

	const asset = await Database.query(`SELECT * FROM Assets WHERE discord_id = ?`, [id]).then(x => x[0]) as Asset | null;
	if (!asset) return null;

	return asset;
}