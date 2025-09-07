const crypto = require('node:crypto');

const MASTER_KEY = Buffer.from(process.env.PEPPER, 'base64');

/**
 * Wraps a key with another key using AES-256-GCM.
 * This should not be used for user keys, use WrapUserKey() instead.
 * @param wrappingKey
 * @param keyToWrap
 * @returns {Buffer<ArrayBuffer>}
 */
function WrapKey(keyToWrap, wrappingKey) {
	const iv = crypto.randomBytes(12);
	const cipher = crypto.createCipheriv('aes-256-gcm', wrappingKey, iv);
	const wrapped = Buffer.concat([cipher.update(keyToWrap), cipher.final()]);
	const tag = cipher.getAuthTag();
	return Buffer.concat([iv, wrapped, tag]); // 12 + length(wrapped) + 16
}

/**
 * Undoes WrapKey() given the same wrapping key
 * @param wrappingKey
 * @param wrappedBlob
 * @returns {Buffer<ArrayBuffer>}
 */
function UnwrapKey(wrappedBlob, wrappingKey) {
	const iv = wrappedBlob.subarray(0, 12);
	const tag = wrappedBlob.subarray(wrappedBlob.length - 16);
	// encrypted key is in the middle
	const encryptedKey = wrappedBlob.subarray(12, wrappedBlob.length - 16);
	const decipher = crypto.createDecipheriv('aes-256-gcm', wrappingKey, iv);
	decipher.setAuthTag(tag);
	return Buffer.concat([decipher.update(encryptedKey), decipher.final()]); // original key
}

function WrapUserKey(key) {
	return WrapKey(key, MASTER_KEY);
}

function UnwrapUserKey(wrappedBlob) {
	return UnwrapKey(wrappedBlob, MASTER_KEY);
}

module.exports = {
	WrapKey,
	UnwrapKey,
	WrapUserKey,
	UnwrapUserKey
}