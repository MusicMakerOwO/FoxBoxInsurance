import {randomBytes} from "node:crypto";
import {SimpleUser} from "../Typings/DatabaseTypes.js";
import {GetUser, SaveUser} from "../CRUD/Users.js";
import * as v1 from "../Utils/Encryption/Versions/v1.js"
import {Log} from "../Utils/Log.js";

function BuildNewKey() {
	return randomBytes(32);
}

/** Automatically unwraps the key */
export async function ResolveUserKey(userID: SimpleUser['id']): Promise<Buffer> {
	const savedUser = await GetUser(userID);
	if (!savedUser) throw new Error('User not found');
	if (savedUser.wrapped_key) return v1.Decrypt(savedUser.wrapped_key, Buffer.from(process.env.PEPPER!, 'base64'));

	const newKey = BuildNewKey();
	savedUser.wrapped_key = v1.Encrypt(newKey, Buffer.from(process.env.PEPPER!, 'base64'));

	await SaveUser(savedUser);

	return newKey;
}

/** Returns a map of user IDs to unwrapped keys. Users that cannot be resolved are skipped, not thrown. */
export async function ResolveUserKeyBulk(userIDs: SimpleUser['id'][]): Promise<Map<SimpleUser['id'], Buffer>> {
	const result = new Map<SimpleUser['id'], Buffer>();

	for (const id of new Set(userIDs)) {
		try {
			result.set(id, await ResolveUserKey(id));
		} catch (error) {
			Log('ERROR', `Could not resolve encryption key for user ${id} - skipping`, error);
		}
	}

	return result;
}