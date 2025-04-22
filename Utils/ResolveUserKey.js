const crtypto = require('crypto');
const Database = require('./Database');
const Tasks = require('./TaskScheduler');

const MAX_CACHE_SIZE = 1000; // max size of the cache

const cache = new Map(); // userID -> key
module.exports = function ResolveUserKey(userID) {
	if (cache.has(userID)) return cache.get(userID); // buffer
	
	// blob
	const savedKey = Database.prepare('SELECT key FROM users WHERE id = ?').pluck().get(userID);
	if (savedKey) {
		cache.set(userID, savedKey);
		return savedKey;
	}

	const key = crtypto.scryptSync(userID, process.env.SALT, 32);
	cache.set(userID, key);
	Database.prepare('UPDATE users SET key = ? WHERE id = ?').run(key, userID);

	return key;
}

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