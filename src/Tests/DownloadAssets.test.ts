import { describe, it, expect, vi, beforeEach } from 'vitest';

const { batch } = vi.hoisted(() => ({ batch: vi.fn() }));
vi.mock('../Database.js', () => ({ Database: { batch } }));

const { TestConnection } = vi.hoisted(() => ({ TestConnection: vi.fn() }));
vi.mock('../Utils/TestConnection.js', () => ({ TestConnection }));

const { existsSync, mkdirSync, readdirSync, writeFileSync } = vi.hoisted(() => ({
	existsSync: vi.fn(() => true),
	mkdirSync: vi.fn(),
	readdirSync: vi.fn(() => []),
	writeFileSync: vi.fn()
}));
vi.mock('node:fs', () => ({
	default: {
		existsSync,
		mkdirSync,
		readdirSync,
		writeFileSync,
		promises: { writeFile: vi.fn() }
	},
	existsSync,
	mkdirSync,
	readdirSync,
	writeFileSync,
	unlinkSync: vi.fn(),
	promises: { writeFile: vi.fn() }
}));

import { QueueDownload, DownloadAssets, ASSET_TYPE } from '../Utils/Processing/Images.js';

beforeEach(() => {
	vi.useFakeTimers();
	batch.mockReset();
	// simulate the real mariadb driver rejecting an empty batch, to prove the guard actually prevents the call
	batch.mockImplementation(async (_sql: string, params: unknown[]) => {
		if (params.length === 0) throw new Error('batch called with empty array');
	});
	TestConnection.mockReset();
	existsSync.mockReset().mockReturnValue(true);
	mkdirSync.mockReset();
	readdirSync.mockReset().mockReturnValue([]);
	writeFileSync.mockReset();
});

describe('DownloadAssets', () => {
	it('does not call Database.batch with an empty array when every asset fails to download, and still persists the retry cache', async () => {
		TestConnection.mockResolvedValue(false); // no internet - every asset fails immediately

		QueueDownload({
			id: '111000000000000001',
			type: ASSET_TYPE.ATTACHMENT,
			name: 'test.png',
			url: 'https://cdn.discordapp.com/attachments/x/test.png',
			width: null,
			height: null
		});

		await vi.runOnlyPendingTimersAsync();
		await DownloadAssets();

		expect(batch).not.toHaveBeenCalled();
		expect(writeFileSync).toHaveBeenCalled(); // failed downloads persisted for retry

		vi.useRealTimers();
	});
});
