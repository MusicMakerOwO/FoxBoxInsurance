import {createCipheriv, createDecipheriv, randomBytes} from "node:crypto";

if (!process.env.PEPPER) throw new Error('No encryption key provided - Set a base64 key in .env');

const MASTER_KEY = Buffer.from(process.env.PEPPER, 'base64');

/**
 * Wraps a key with another key using AES-256-GCM.
 * This should not be used for user keys, use WrapUserKey() instead.
 */
export function WrapKey(keyToWrap: string | Buffer, wrappingKey: Buffer) {
	const iv = randomBytes(12);
	const cipher = createCipheriv('aes-256-gcm', wrappingKey, iv);
	const wrapped = Buffer.concat([cipher.update(keyToWrap), cipher.final()]);
	const tag = cipher.getAuthTag();
	return Buffer.concat([iv, wrapped, tag]); // 12 + length(wrapped) + 16
}

/**
 * Undoes WrapKey() given the same wrapping key
 */
export function UnwrapKey(wrappedBlob: Buffer, wrappingKey: Buffer) {
	const iv = wrappedBlob.subarray(0, 12);
	const tag = wrappedBlob.subarray(wrappedBlob.length - 16);
	// encrypted key is in the middle
	const encryptedKey = wrappedBlob.subarray(12, wrappedBlob.length - 16);
	const decipher = createDecipheriv('aes-256-gcm', wrappingKey, iv);
	decipher.setAuthTag(tag);
	return Buffer.concat([decipher.update(encryptedKey), decipher.final()]); // original key
}

export function WrapUserKey(key: Buffer) {
	return WrapKey(key, MASTER_KEY);
}

export function UnwrapUserKey(wrappedBlob: Buffer) {
	return UnwrapKey(wrappedBlob, MASTER_KEY);
}