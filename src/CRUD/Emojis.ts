import {SimpleEmoji} from "../Typings/DatabaseTypes.js";
import {LRUCache} from "../Utils/DataStructures/LRUCache.js";
import {Database} from "../Database.js";

const cache = new LRUCache<SimpleEmoji['id'], SimpleEmoji>(1_000);

export async function GetEmoji(id: SimpleEmoji['id']): Promise<SimpleEmoji | null> {
	id = BigInt(id);
	if (cache.has(id)) return cache.get(id)!;

	const dbEmoji = await Database.query(`SELECT * FROM Emojis WHERE id = ?`, [id]).then(x => x[0]) as SimpleEmoji | null;
	if (!dbEmoji) return null;

	return dbEmoji;
}