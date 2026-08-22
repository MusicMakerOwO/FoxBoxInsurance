import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ChatInputCommandInteraction } from 'discord.js';
import { createHash } from 'node:crypto';
import { IClient } from '../Client.js';

const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('../Database.js', () => ({ Database: { query } }));

import Verify from '../Commands/Verify.js';

function makeInteraction(exportID: string, fileURL: string) {
	return {
		options: {
			getString    : (name: string) => (name === 'export_id' ? exportID : null),
			getAttachment: () => ({ url: fileURL })
		},
		editReply: vi.fn()
	} as unknown as ChatInputCommandInteraction;
}

beforeEach(() => {
	query.mockReset();
	vi.useFakeTimers();
	vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

async function runExecute(interaction: ChatInputCommandInteraction) {
	const promise = Verify.execute(interaction, {} as IClient);
	await vi.advanceTimersByTimeAsync(2000);
	return promise as Promise<{ embeds: { description: string }[] }>;
}

describe('Verify', () => {
	it('hashes the raw bytes of the downloaded file, not a UTF-8 decoded string', async () => {
		// bytes that are not valid UTF-8 - decoding to text and re-hashing would produce a different hash
		const rawBytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
		const expectedHash = createHash('sha256').update(rawBytes).digest('hex');

		query.mockResolvedValue([{ hash: expectedHash, hash_algorithm: 'sha256' }]);
		(fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
			ok        : true,
			status    : 200,
			statusText: 'OK',
			arrayBuffer: async () => rawBytes.buffer.slice(rawBytes.byteOffset, rawBytes.byteOffset + rawBytes.byteLength)
		});

		const interaction = makeInteraction('AAAA-BBBB-CCCC-DDDD', 'https://cdn.example/file.bin');
		const result = await runExecute(interaction);

		expect(result.embeds[0].description).toContain('clean');
	});

	it('treats a non-2xx HTTP response as a failed download rather than hashing the error body', async () => {
		query.mockResolvedValue([{ hash: 'deadbeef', hash_algorithm: 'sha256' }]);
		(fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
			ok        : false,
			status    : 404,
			statusText: 'Not Found',
			arrayBuffer: async () => Buffer.from('not found')
		});

		const interaction = makeInteraction('AAAA-BBBB-CCCC-DDDD', 'https://cdn.example/expired.bin');
		const result = await Verify.execute(interaction, {} as IClient) as { embeds: { description: string }[] };

		expect(result.embeds[0].description).toContain('Failed to download');
	});
});
