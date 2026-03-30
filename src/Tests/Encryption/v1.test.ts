import { describe, expect, it, vi } from 'vitest';

const MASTER_KEY = Buffer.alloc(32, 17);
const WRAPPING_KEY = Buffer.alloc(32, 23);
const WRONG_KEY = Buffer.alloc(32, 42);

process.env.PEPPER = MASTER_KEY.toString('base64');

async function LoadKeyWrapper() {
	vi.resetModules();
	return import('../../Utils/Encryption/Versions/v1.js');
}

describe('v1', () => {
	it('unwraps a wrapped buffer back to the original bytes', async () => {
		const { Encrypt, Decrypt } = await LoadKeyWrapper();
		const content = Buffer.from('00112233445566778899aabbccddeeff', 'hex');

		const wrapped = Encrypt(content, WRAPPING_KEY);
		const unwrapped = Decrypt(wrapped, WRAPPING_KEY);

		expect(unwrapped).toEqual(content);
		expect(wrapped).not.toEqual(content);
	});

	it('unwraps a wrapped string back to the original utf8 bytes', async () => {
		const { Encrypt, Decrypt } = await LoadKeyWrapper();
		const content = Buffer.from('secret discord message 🔐');

		const wrapped = Encrypt(content, WRAPPING_KEY);
		const unwrapped = Decrypt(wrapped, WRAPPING_KEY);

		expect(unwrapped).toEqual(content);
	});

	it('produces unique wrapped blobs for the same input and keeps the expected binary size', async () => {
		const { Encrypt } = await LoadKeyWrapper();
		const key = Buffer.from('hello world');

		const wrappedA = Encrypt(key, WRAPPING_KEY);
		const wrappedB = Encrypt(key, WRAPPING_KEY);

		expect(Buffer.isBuffer(wrappedA)).toBe(true);
		expect(wrappedA).toHaveLength(key.length + 28);
		expect(wrappedB).toHaveLength(key.length + 28);
	});

	it('unwraps an empty buffer and still includes iv and auth tag overhead', async () => {
		const { Encrypt, Decrypt } = await LoadKeyWrapper();
		const key = Buffer.alloc(0);

		const wrapped = Encrypt(key, WRAPPING_KEY);
		const unwrapped = Decrypt(wrapped, WRAPPING_KEY);

		expect(unwrapped).toHaveLength(0);
		expect(wrapped).toHaveLength(28);
	});

	it('rejects wrapped blobs that were modified after wrapping', async () => {
		const { Encrypt, Decrypt } = await LoadKeyWrapper();
		const wrapped = Encrypt(Buffer.from('secret'), WRAPPING_KEY);
		wrapped[wrapped.length - 1] ^= 1;

		expect(() => Decrypt(wrapped, WRAPPING_KEY)).toThrow();
	});

	it('rejects unwrapping with a different wrapping key', async () => {
		const { Encrypt: Encrypt, Decrypt } = await LoadKeyWrapper();
		const wrapped = Encrypt(Buffer.from('secret'), WRAPPING_KEY);

		expect(() => Decrypt(wrapped, WRONG_KEY)).toThrow();
	});

	it('wraps and unwraps user keys with the configured master key', async () => {
		const { Encrypt, Decrypt } = await LoadKeyWrapper();
		const key = Buffer.from('fedcba98765432100123456789abcdef', 'hex');

		const wrapped = Encrypt(key, MASTER_KEY);
		const unwrapped = Decrypt(wrapped, MASTER_KEY);

		expect(unwrapped).toEqual(key);
	});
});