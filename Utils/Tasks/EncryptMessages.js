const Database = require("../Database")
const Log = require("../Logs")
const crypto = require("crypto")
const { ResolveUserKeyBulk } = require("../ResolveUserKey")

module.exports = async function EncryptMessages() {
	const unencryptedMessages = await Database.query("SELECT id, user_id, content FROM Messages WHERE encrypted = 0");
	if (unencryptedMessages.length === 0) {
		Log.success("Nothing to encrypt");
		return;
	}

	Log.success(`Encrypting ${unencryptedMessages.length} messages...`);

	const connection = await Database.getConnection();

	const UpdateStatement = await connection.prepare("UPDATE Messages SET content = ?, tag = ?, encrypted = 1 WHERE id = ?");

	const userKeys = await ResolveUserKeyBulk(unencryptedMessages.map(m => m.user_id));

	const start = process.hrtime.bigint();
	for (const message of unencryptedMessages) {
		if (message.content === null) {
			UpdateStatement.run(null, null, message.id);
			continue;
		}

		const key = userKeys[message.user_id];

		const iv = crypto.createHash("sha256").update(`${message.id}${message.user_id}`).digest("hex").slice(0, 16);
		const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);

		const encrypted = cipher.update(message.content ?? '', "utf8", "base64") + cipher.final("base64");
		const tag = cipher.getAuthTag().toString("base64");

		UpdateStatement.execute([encrypted, tag, message.id]);
	}

	UpdateStatement.close();
	Database.releaseConnection(connection);

	const end = process.hrtime.bigint();
	const time = Number(end - start) / 1e6;
	Log.success(`Encrypted ${unencryptedMessages.length} messages in ${time.toFixed(2)}ms (${(unencryptedMessages.length / (time / 1000)).toFixed(2)} messages/s)`);
}