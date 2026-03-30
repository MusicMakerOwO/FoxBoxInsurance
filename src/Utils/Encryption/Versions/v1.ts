import {createCipheriv, createDecipheriv, randomBytes} from "node:crypto";

export function Encrypt(content: Buffer, wrappingKey: Buffer) {
	const iv = randomBytes(12);
	const cipher = createCipheriv('aes-256-gcm', wrappingKey, iv);
	const wrapped = Buffer.concat([cipher.update(content), cipher.final()]);
	const tag = cipher.getAuthTag();
	return Buffer.concat([iv, wrapped, tag]); // 12 + length(wrapped) + 16
}

export function Decrypt(wrappedBlob: Buffer, wrappingKey: Buffer) {
	const iv = wrappedBlob.subarray(0, 12);
	const tag = wrappedBlob.subarray(wrappedBlob.length - 16);
	// encrypted key is in the middle
	const encryptedKey = wrappedBlob.subarray(12, wrappedBlob.length - 16);
	const decipher = createDecipheriv('aes-256-gcm', wrappingKey, iv);
	decipher.setAuthTag(tag);
	return Buffer.concat([decipher.update(encryptedKey), decipher.final()]); // original key
}