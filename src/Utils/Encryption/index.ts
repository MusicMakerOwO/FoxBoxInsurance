import * as v1 from "./Versions/v1";

const VERSIONS: Record<number, {
	Encrypt: (content: Buffer, key: Buffer) => Buffer
	Decrypt: (cipherText: Buffer, key: Buffer) => Buffer
}> = {
	1: v1
} as const;

/** Version 0 means no encryption */
export function Encrypt(content: string | Buffer, key: Buffer, version = 1): [ cipherText: Buffer, version: number ] {
	const contentBuffer = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
	if (version === 0) return [ contentBuffer, 0 ];

	if (!(version in VERSIONS)) throw new Error(`Unsupported encryption version ${version}`);
	const scheme = VERSIONS[version]!;

	const cipherText = scheme.Encrypt(contentBuffer, key);
	return [ cipherText, version ];
}

export function Decrypt(cipherText: Buffer, key: Buffer, version: number): Buffer {
	if (version === 0) return cipherText;

	if (!(version in VERSIONS)) throw new Error(`Unsupported encryption version ${version}`);
	const scheme = VERSIONS[version]!;
	return scheme.Decrypt(cipherText, key);
}