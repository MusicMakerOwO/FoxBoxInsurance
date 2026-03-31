import {createCipheriv, createDecipheriv, randomBytes} from "node:crypto";

export function Encrypt(content: Buffer, key: Buffer) {
	const iv = randomBytes(12);
	const cipher = createCipheriv('aes-256-gcm', key, iv);
	const cipherText = Buffer.concat([cipher.update(content), cipher.final()]);
	const tag = cipher.getAuthTag();
	return Buffer.concat([iv, cipherText, tag]); // 12 + length(wrapped) + 16
}

export function Decrypt(wrappedBlob: Buffer, key: Buffer) {
	const iv = wrappedBlob.subarray(0, 12);
	const tag = wrappedBlob.subarray(wrappedBlob.length - 16);
	// encrypted key is in the middle
	const encryptedKey = wrappedBlob.subarray(12, wrappedBlob.length - 16);
	const content = createDecipheriv('aes-256-gcm', key, iv);
	content.setAuthTag(tag);
	return Buffer.concat([content.update(encryptedKey), content.final()]); // original key
}