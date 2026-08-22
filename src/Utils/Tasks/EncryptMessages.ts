import { Log } from "../Log.js";
import { Database } from "../../Database.js";
import { ResolveUserKeyBulk } from "../../Services/UserEncryptionKeys.js";
import { SimpleMessage } from "../../Typings/DatabaseTypes.js";
import { Encrypt } from "../Encryption/index.js";

const MESSAGE_BATCH_LIMIT = 10_000;

export async function EncryptMessages(): Promise<void> {
	const unencryptedMessages = await Database.query(`SELECT id, user_id, content FROM Messages WHERE encryption_version IS NULL LIMIT ${MESSAGE_BATCH_LIMIT}`) as Pick<SimpleMessage, 'id' | 'user_id' | 'content'>[];
	if (unencryptedMessages.length === 0) return;

	Log('TRACE', `Encrypting ${unencryptedMessages.length} messages...`);

	const userKeys = await ResolveUserKeyBulk(unencryptedMessages.map(m => m.user_id));

	const updateValues: [
		content: Buffer | null,
		encryption_version: number,
		message_id: bigint
	][] = [];

	const start = process.hrtime.bigint();
	for (const message of unencryptedMessages) {
		if (message.content === null) {
			updateValues.push([null, 0, message.id]);
			continue;
		}
		const userKey = userKeys.get(message.user_id);
		if (!userKey) continue; // author is unresolvable - leave this message for a later run
		const [cipherText, version] = Encrypt(message.content, userKey);
		updateValues.push([cipherText, version, message.id])
	}
	const end = process.hrtime.bigint();

	if (updateValues.length > 0) {
		await Database.transaction(async (connection) => {
			await connection.batch(`
	            UPDATE Messages
	            SET content            = ?,
	                encryption_version = ?
	            WHERE id = ?
			`, updateValues);
		});
	}

	const time = Number(end - start) / 1e6;
	Log('TRACE', `Encrypted ${updateValues.length}/${unencryptedMessages.length} messages in ${time.toFixed(2)}ms`);
}