const crypto = require('crypto');
const Database = require('./Database');
const Tasks = require('./TaskScheduler');

const MAX_CACHE_SIZE = 1000; // max size of the cache
const KEY_LENGTH = 32; // bytes

function BuildNewKey() {
	return crypto.randomBytes(KEY_LENGTH);
}

const cache = new Map(); // userID -> key

async function ResolveUserKey(userID) {
	if (cache.has(userID)) return cache.get(userID); // buffer

	const savedKey = await Database.query('SELECT wrapped_key FROM Users WHERE id = ?', [userID]).then(rows => rows[0]?.wrapped_key);
	if (savedKey) {
		cache.set(userID, savedKey);
		return savedKey;
	}

	const key = BuildNewKey();
	cache.set(userID, key);
	Database.query('UPDATE Users SET wrapped_key = ? WHERE id = ?', [key, userID]);

	return key;
}

async function ResolveUserKeyBulk(userIDs = []) {
	let needsFetch = false;
	const results = Object.fromEntries( userIDs.map(id => [id, cache.get(id) ?? (needsFetch = true, null)]) );
	if (!needsFetch) return results; // all in cache

	const connection = await Database.getConnection();

	const fetchQuery = await connection.prepare(`SELECT wrapped_key FROM Users WHERE id = ?`);

	for (const [userID, key] of Object.entries(results)) {
		if (key) continue; // already in cache

		const key = await fetchQuery.execute(userID).then(rows => rows[0]?.wrapped_key);
		if (key) {
			cache.set(userID, key);
			results[userID] = key;
			continue;
		}

		const newTag = BuildNewKey();
		cache.set(userID, newTag);
		results[userID] = newTag;

		connection.query('UPDATE Users SET wrapped_key = ? WHERE id = ?', [newTag, userID]);
	}

	Database.releaseConnection(connection);

	return results;
}

function DeleteUserKeyFromCache(userID) {
	return cache.delete(userID);
}

module.exports = { ResolveUserKey, ResolveUserKeyBulk, DeleteUserKeyFromCache };

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