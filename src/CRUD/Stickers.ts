import {SimpleSticker} from "../Typings/DatabaseTypes.js";
import {LRUCache} from "../Utils/DataStructures/LRUCache.js";
import {Database} from "../Database.js";

const cache = new LRUCache<SimpleSticker['id'], SimpleSticker>(500);

const INVALID_Sticker_IDS = new Set<SimpleSticker['id']>();

export async function GetSticker(id: SimpleSticker['id']): Promise<SimpleSticker | null> {
	id = BigInt(id);
	if (cache.has(id)) return cache.get(id)!;

	if (INVALID_Sticker_IDS.has(id)) return null;

	const dbSticker = await Database.query(`SELECT * FROM Stickers WHERE id = ?`, [id]).then(x => x[0]) as SimpleSticker | null;
	if (!dbSticker) return null;

	return dbSticker;
}