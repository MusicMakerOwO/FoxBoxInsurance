const crypto = require('crypto');
const Database = require('./Database');
const Tasks = require('./TaskScheduler');

const MAX_CACHE_SIZE = 1000; // max size of the cache
const SALT_LENGTH = 32; // bytes
const KEY_LENGTH = 32; // bytes

function BuildNewKey(userID) {
	const salt = crypto.randomBytes(SALT_LENGTH).toString('hex');
	return crypto.scryptSync(userID, salt, KEY_LENGTH).toString('hex');
}

const cache = new Map(); // userID -> key

async function ResolveUserKey(userID) {
	if (cache.has(userID)) return cache.get(userID); // buffer

	const savedKey = await Database.query('SELECT tag FROM Users WHERE id = ?', [userID]);
	if (savedKey) {
		cache.set(userID, savedKey);
		return savedKey;
	}

	const key = BuildNewKey(userID);
	cache.set(userID, key);
	Database.query('UPDATE Users SET tag = ? WHERE id = ?', [key, userID]);

	return key;
}

async function ResolveUserKeyBulk(userIDs = []) {
	let needsFetch = false;
	const results = Object.fromEntries( userIDs.map(id => [id, cache.get(id) ?? (needsFetch = true, null)]) );
	if (!needsFetch) return results; // all in cache

	const connection = await Database.getConnection();

	const fetchQuery = await connection.prepare(`SELECT tag FROM Users WHERE id = ?`);

	for (const [userID, key] of Object.entries(results)) {
		if (key) continue; // already in cache

		const { tag } = (await fetchQuery.execute(userID))[0] ?? {};
		if (tag) {
			cache.set(userID, tag);
			results[userID] = tag;
			continue;
		}

		const newTag = BuildNewKey(userID);
		cache.set(userID, newTag);
		results[userID] = newTag;

		connection.query('UPDATE Users SET tag = ? WHERE id = ?', [newTag, userID]);
	}

	Database.releaseConnection(connection);

	return results;
}

module.exports = { ResolveUserKey, ResolveUserKeyBulk };

Tasks.schedule(() => {
	if (cache.size < MAX_CACHE_SIZE) return;
	const keysToDelete = cache.size - MAX_CACHE_SIZE + (MAX_CACHE_SIZE * 0.25); // Leave 25% of space free
	const iterator = cache.keys();
	for (let i = 0; i < keysToDelete; i++) {
		const key = iterator.next();
		if (key.done) break; // cache is empty, oops...
		cache.delete(key.value);
	}
}, 1000 * 60 * 60); // every hour