import {randomBytes} from "node:crypto";
import {SimpleUser} from "../Typings/DatabaseTypes";
import {GetUser, SaveUser} from "../CRUD/Users";
import * as v1 from "../Utils/Encryption/Versions/v1"

function BuildNewKey() {
	return randomBytes(32);
}

/** Automatically unwraps the key */
export async function ResolveUserKey(userID: SimpleUser['id']) {
	const savedUser = await GetUser(userID);
	if (!savedUser) throw new Error('User not found');
	if (savedUser.wrapped_key) return v1.Decrypt(savedUser.wrapped_key, Buffer.from(process.env.PEPPER!, 'base64'));

	const newKey = BuildNewKey();
	savedUser.wrapped_key = v1.Encrypt(newKey, Buffer.from(process.env.PEPPER!, 'base64'));

	void SaveUser(savedUser);

	return newKey;
}

/** Returns a map of user IDs to unwrapped keys */
export async function ResolveUserKeyBulk(userIDs: SimpleUser['id'][]) {
	const result = new Map<SimpleUser['id'], Buffer>();

	for (const id of userIDs) {
		result.set(id, await ResolveUserKey(id) );
	}

	return result;
}