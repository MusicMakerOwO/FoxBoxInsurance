import {randomBytes} from "node:crypto";
import {SimpleUser} from "../Typings/DatabaseTypes";
import {GetUser, SaveUser} from "../CRUD/Users";
import {UnwrapUserKey, WrapUserKey} from "../Utils/Encryption/KeyWrapper";

function BuildNewKey() {
	return randomBytes(32);
}

export async function ResolveUserKey(userID: SimpleUser['id']) {
	const savedUser = await GetUser(userID);
	if (!savedUser) throw new Error('User not found');
	if (savedUser.wrapped_key) return UnwrapUserKey(savedUser.wrapped_key);

	const newKey = BuildNewKey();
	savedUser.wrapped_key = WrapUserKey(newKey);

	void SaveUser(savedUser);

	return newKey;
}

export async function ResolveUserKeyBulk(userIDs: SimpleUser['id'][]) {
	const result = new Map<SimpleUser['id'], Buffer>();

	for (const id of userIDs) {
		result.set(id, await ResolveUserKey(id) );
	}

	return result;
}