const { promisify } = require("util")
const Database = require("../Database")
const Log = require("../Logs")
const crypto = require("crypto")
const ResolveUserKey = require("../ResolveUserKey")

const scryptAsync = promisify(crypto.scrypt)

module.exports = async function EncryptMessages() {
	const unencryptedMessages = Database.prepare("SELECT id, user_id, content FROM Messages WHERE encrypted = 0").all();
	if (unencryptedMessages.length === 0) {
		Log.success("Nothing to encrypt");
		return;
	}

	Log.success(`Encrypting ${unencryptedMessages.length} messages...`);

	const UpdateStatement = Database.prepare("UPDATE Messages SET content = ?, tag = ?, encrypted = 1 WHERE id = ?");

	const start = process.hrtime.bigint();
	for (const message of unencryptedMessages) {
		if (message.content === null) {
			UpdateStatement.run(null, null, message.id);
			continue;
		}

		const key = ResolveUserKey(message.user_id);

		const iv = crypto.createHash("sha256").update(`${message.id}${message.user_id}`).digest("hex").slice(0, 16);
		const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);

		const encrypted = cipher.update(message.content ?? '', "utf8", "base64") + cipher.final("base64");
		const tag = cipher.getAuthTag().toString("base64");

		UpdateStatement.run(encrypted, tag, message.id);
	}

	const end = process.hrtime.bigint();
	const time = Number(end - start) / 1e6;
	Log.success(`Encrypted ${unencryptedMessages.length} messages in ${time.toFixed(2)}ms (${(unencryptedMessages.length / (time / 1000)).toFixed(2)} messages/s)`);
}
