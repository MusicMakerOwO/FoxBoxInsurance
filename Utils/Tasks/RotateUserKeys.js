const crypto = require('node:crypto');
const Database = require("../Database");
const KeyWrapper = require("../Encryption/KeyWrapper");
const { DeleteUserKeyFromCache } = require("../Encryption/ResolveUserKey");
const Log = require("../Logs");

module.exports = async function RotateUserKeys() {
	const currentHour = new Date().getHours();
	const userIDs = await Database.query("SELECT id FROM Users WHERE wrapped_key IS NOT NULL AND rotation_hour = ?", [currentHour]).then(rows => rows.map(r => r.id));
	if (userIDs.length === 0) {
		console.log("No user keys to rotate");
		return;
	}

	Log.success(`Rotating keys for ${userIDs.length} users ...`);

	const connection = await Database.getConnection();

	const selectQuery = await connection.prepare("SELECT wrapped_key FROM Users WHERE id = ?");
	const updateQuery = await connection.prepare("UPDATE Users SET wrapped_key = ? WHERE id = ?");

	const userKeys = {};

	// if something goes wrong we can safely roll back without corrupting data
	await connection.query("BEGIN");

	const rotationStart = Date.now();

	for (let i = 0; i < userIDs.length; i++) {
		const userID = userIDs[i];

		const wrappedKey = await selectQuery.execute([userID]).then(rows => rows[0]?.wrapped_key);
		if (!wrappedKey) {
			console.warn(`User ${userID} has no wrapped key, skipping...`);
			continue;
		}

		const oldKey = KeyWrapper.UnwrapUserKey(wrappedKey);
		const newKey = crypto.randomBytes(32); // 256 bits

		userKeys[userID] = { oldKey, newKey };

		const newWrappedKey = KeyWrapper.WrapUserKey(newKey);

		DeleteUserKeyFromCache(userID); // does exactly what you think it does lmao

		await updateQuery.execute([newWrappedKey, userID]);
	}

	selectQuery.close();
	updateQuery.close();

	const rotationEnd = Date.now();
	Log.success(`Rotated ${Object.keys(userKeys).length} user keys in ${(rotationEnd - rotationStart) / 1000}s`);

	// now we have to re-wrap every message the user has ever sent
	// This is the expensive part and the reason users are staggered by hour
	const batchSize = 1_000;

	const selectMessagesQuery = await connection.prepare("SELECT id, wrapped_dek FROM Messages WHERE user_id = ? LIMIT ? OFFSET ?");
	const updateDekQuery = await connection.prepare("UPDATE Messages SET wrapped_dek = ? WHERE id = ?");

	const promiseQueue = [];

	for (let i = 0; i < userIDs.length; i++) {

		const wrapStart = Date.now();

		const userID = userIDs[i];
		const keys = userKeys[userID];
		if (!keys) {
			Log.error(`No old key for user ${userID} - These messages will be lost forever!`);
			Log.error(`Key rotation has been rolled back for safety`);

			// hard rollback - something went very wrong and we can't risk data integrity
			await connection.query("ROLLBACK");
			return;
		}

		await connection.query(`SAVEPOINT user-${userID}`);

		const { oldKey, newKey } = keys;

		let messageCount = 0;

		for (let offset = 0; ; offset += batchSize) {
			const messages = await selectMessagesQuery.execute([userID, batchSize, offset]);
			if (messages.length === 0) break;
			messageCount += messages.length;

			for (let k = 0; k < messages.length; k++) {
				const { id, wrapped_dek } = messages[k];
				const dek = KeyWrapper.UnwrapKey(wrapped_dek, oldKey);
				const newWrappedDEK = KeyWrapper.WrapKey(dek, newKey);
				promiseQueue.push( updateDekQuery.execute([newWrappedDEK, id]) );
			}
		}

		await Promise.all(promiseQueue);

		await connection.query(`RELEASE SAVEPOINT user-${userID}`);

		const wrapEnd = Date.now();
		const duration = (wrapEnd - wrapStart) / 1000;

		Log.success(`Re-wrapped ${messageCount} messages for user ${userID} in ${duration}s (${(messageCount / duration).toFixed(2)} msg/s)`);
	}

	await connection.query("COMMIT");

}