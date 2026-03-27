import {SimpleMessage} from "../Typings/DatabaseTypes";
import {LRUCache} from "../Utils/DataStructures/LRUCache";
import {Database} from "../Database";

const cache = new LRUCache<SimpleMessage['id'], SimpleMessage>(20_000);

const INVALID_MESSAGE_IDS = new Set<SimpleMessage['id']>();

/**
 * Grabs a message directly from the database. The message content is not decrypted.
 */
export async function GetMessage(id: SimpleMessage['id']) {
	id = BigInt(id);
	if (cache.has(id)) return cache.get(id)!;

	if (INVALID_MESSAGE_IDS.has(id)) return null;

	const dbMessage = await Database.query(`SELECT * FROM Messages WHERE id = ?`, [id]).then(x => x[0]) as SimpleMessage | null;
	if (!dbMessage) return null;

	return dbMessage;
}

/**
 * Fetches a bunch of messages at once. Each of these also gets added to cache.
 * Like with the single fetch, none of these messages are decrypted.
 */
export async function GetMessageBulk(ids: SimpleMessage['id'][]) {
	const result = new Map<SimpleMessage['id'], SimpleMessage>();

	const missingIDs: SimpleMessage['id'][] = [];
	for (const id of ids) {
		if (cache.has(id)) {
			result.set(id, cache.get(id)!);
			continue;
		}
		missingIDs.push(id);
	}

	if (missingIDs.length === 0) return result;

	const data = await Database.query(`SELECT * FROM Messages WHERE id IN (${'?,'.repeat(missingIDs.length - 1)} ?)`) as SimpleMessage[];
	for (const message of data) {
		cache.set(message.id, message);
		result.set(message.id, message);
	}

	return result;
}

/**
 * Removes the provided message from cache if it exists, however the data will still exist in database.
 * If you intend to delete all the related data, use `DANGER_PurgeMessage()` instead.
 */
export async function DiscardMessage(id: bigint) {
	cache.delete(id);
	INVALID_MESSAGE_IDS.delete(id);
}

/**
 * Deletes ALL the associated data with the given message.
 *
 * THIS CANNOT BE UNDONE!!!
 */
export async function DANGER_PurgeMessage(id: bigint) {
	await Database.query('DELETE FROM Messages WHERE id = ?', [id]);
}