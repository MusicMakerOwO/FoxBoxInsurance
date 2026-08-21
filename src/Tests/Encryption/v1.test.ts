import { describe, it, expect } from 'vitest';
import { randomBytes } from 'node:crypto';
import { Encrypt, Decrypt } from '../../Utils/Encryption/Versions/v1.js';

const key = randomBytes(32);

describe('Encryption v1', () => {
	it('unwraps a wrapped buffer back to the original bytes', () => {
		const original = randomBytes(64);
		const wrapped = Encrypt(original, key);
		expect(Decrypt(wrapped, key)).toEqual(original);
	});

	it('unwraps a wrapped string back to the original utf8 bytes', () => {
		const original = 'Fox Box Insurance 🦊';
		const originalBytes = Buffer.from(original, 'utf8');
		const wrapped = Encrypt(originalBytes, key);
		expect(Decrypt(wrapped, key).toString('utf8')).toBe(original);
	});

	it('produces unique wrapped blobs for the same input and keeps the expected binary size', () => {
		const content = Buffer.from('identical content', 'utf8');
		const wrappedA = Encrypt(content, key);
		const wrappedB = Encrypt(content, key);

		expect(wrappedA.equals(wrappedB)).toBe(false); // random IV per call
		expect(wrappedA.length).toBe(content.length + 12 + 16); // iv + ciphertext + auth tag
		expect(wrappedB.length).toBe(content.length + 12 + 16);
	});

	it('unwraps an empty buffer and still includes iv and auth tag overhead', () => {
		const empty = Buffer.alloc(0);
		const wrapped = Encrypt(empty, key);
		expect(wrapped.length).toBe(12 + 16); // no ciphertext bytes, just iv + tag
		expect(Decrypt(wrapped, key)).toEqual(empty);
	});

	it('rejects wrapped blobs that were modified after wrapping', () => {
		const wrapped = Encrypt(Buffer.from('sensitive message', 'utf8'), key);
		const tampered = Buffer.from(wrapped);
		tampered[tampered.length - 1] ^= 0xff; // flip a bit inside the auth tag

		expect(() => Decrypt(tampered, key)).toThrow();
	});

	it('rejects unwrapping with a different wrapping key', () => {
		const wrapped = Encrypt(Buffer.from('sensitive message', 'utf8'), key);
		const wrongKey = randomBytes(32);

		expect(() => Decrypt(wrapped, wrongKey)).toThrow();
	});

	it('wraps and unwraps user keys with the configured master key', () => {
		expect(process.env.PEPPER).toBeTruthy();
		const masterKey = Buffer.from(process.env.PEPPER!, 'base64');
		const userKey = randomBytes(32);

		const wrappedUserKey = Encrypt(userKey, masterKey);
		expect(Decrypt(wrappedUserKey, masterKey)).toEqual(userKey);
	});
});
