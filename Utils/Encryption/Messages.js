const crypto = require('node:crypto');

function EncryptMessage(plaintext, key) {
	if (plaintext === null) return { encrypted: null, tag: null, iv: null };
	const iv = crypto.randomBytes(12);
	const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
	const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
	const tag = cipher.getAuthTag();
	return { encrypted, tag, iv };
}

function DecryptMessage(encrypted, tag, iv, key) {
	if (encrypted === null) return null;
	const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
	decipher.setAuthTag(tag);
	const plain = Buffer.concat([decipher.update(encrypted), decipher.final()]);
	return plain.toString('utf8');
}

module.exports = { EncryptMessage, DecryptMessage };