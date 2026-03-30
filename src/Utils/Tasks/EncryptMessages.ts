import { Log } from "../Log";
import { Database } from "../../Database";
import { ResolveUserKeyBulk } from "../../Services/UserEncryptionKeys";
import { SimpleMessage } from "../../Typings/DatabaseTypes";
import { Encrypt } from "../Encryption";

export async function EncryptMessages() {
	const unencryptedMessages = await Database.query("SELECT id, user_id, content FROM Messages WHERE encryption_version IS NULL") as Pick<SimpleMessage, 'id' | 'user_id' | 'content'>[];
	if (unencryptedMessages.length === 0) return;

	Log('TRACE', `Encrypting ${unencryptedMessages.length} messages...`);

	const userKeys = await ResolveUserKeyBulk(unencryptedMessages.map(m => m.user_id));

	const updateValues: [Buffer | null, number, bigint][] = [];

	const start = process.hrtime.bigint();
	for (const message of unencryptedMessages) {
		if (message.content === null) {
			updateValues.push([null, 0, message.id]);
			continue;
		}
		const userKey = userKeys.get(message.user_id)!;
		const [cipherText, version] = Encrypt(message.content, userKey);
		updateValues.push([cipherText, version, message.id])
	}
	const end = process.hrtime.bigint();

	const connection = await Database.getConnection();
	await connection.query('START TRANSACTION');
	await connection.batch(`
        UPDATE Messages
        SET content            = ?,
            encryption_version = ?
        WHERE id = ?
	`, updateValues);
	await connection.query('COMMIT');

	Database.releaseConnection(connection);

	const time = Number(end - start) / 1e6;
	Log('TRACE', `Encrypted ${unencryptedMessages.length} messages in ${time.toFixed(2)}ms`);
}