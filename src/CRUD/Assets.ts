import {Asset} from "../Typings/DatabaseTypes";
import {LRUCache} from "../Utils/DataStructures/LRUCache";
import {Database} from "../Database";

const cache = new LRUCache<Asset['discord_id'], Asset>(2_000);

const INVALID_EMOJI_IDS = new Set<Asset['discord_id']>();

export async function GetAsset(id: Asset['discord_id']) {
	id = BigInt(id);
	if (cache.has(id)) return cache.get(id)!;

	if (INVALID_EMOJI_IDS.has(id)) return null;

	const asset = await Database.query(`SELECT * FROM Assets WHERE discord_id = ?`, [id]).then(x => x[0]) as Asset | null;
	if (!asset) return null;

	return asset;
}