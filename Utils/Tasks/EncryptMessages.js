const Database = require("../Database")
const Log = require("../Logs")
const crypto = require("crypto")
const { ResolveUserKeyBulk } = require("../Encryption/ResolveUserKey")
const { EncryptMessage } = require("../Encryption/Messages");
const { WrapKey, UnwrapUserKey } = require("../Encryption/KeyWrapper");

module.exports = async function EncryptMessages() {
	const unencryptedMessages = await Database.query("SELECT id, user_id, content FROM Messages WHERE encrypted = 0");
	if (unencryptedMessages.length === 0) return;

	Log.success(`Encrypting ${unencryptedMessages.length} messages...`);

	const connection = await Database.getConnection();

	const UpdateStatement = await connection.prepare(`
		UPDATE Messages
		SET content = ?,
		    encrypted = 1,
		    iv = ?,
		    wrapped_dek = ?,
		    tag = ?
		WHERE id = ?
	`);

	const userKeys = await ResolveUserKeyBulk(unencryptedMessages.map(m => m.user_id));

	const updateQueue = [];

	const start = process.hrtime.bigint();
	for (const message of unencryptedMessages) {
		if (message.content === null) {
			updateQueue.push( UpdateStatement.execute([null, null, null, null, message.id]) );
			continue;
		}

		const wrappedUserkey = userKeys[message.user_id];
		const userKey = UnwrapUserKey(wrappedUserkey);

		const dek = crypto.randomBytes(32); // dek = data encryption key
		const { iv, tag, encrypted } = EncryptMessage(message.content, dek);

		const wrappedDek = WrapKey(dek, userKey);

		updateQueue.push( UpdateStatement.execute([encrypted, iv, wrappedDek, tag, message.id]) );
	}

	await Promise.all(updateQueue);

	UpdateStatement.close();
	Database.releaseConnection(connection);

	const end = process.hrtime.bigint();
	const time = Number(end - start) / 1e6;
	Log.success(`Encrypted ${unencryptedMessages.length} messages in ${time.toFixed(2)}ms (${(unencryptedMessages.length / (time / 1000)).toFixed(2)} messages/s)`);
}