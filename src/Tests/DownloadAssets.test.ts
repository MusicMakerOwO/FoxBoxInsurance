import { describe, it, expect, vi, beforeEach } from 'vitest';

const { batch } = vi.hoisted(() => ({ batch: vi.fn() }));
vi.mock('../Database.js', () => ({ Database: { batch } }));

const { TestConnection } = vi.hoisted(() => ({ TestConnection: vi.fn() }));
vi.mock('../Utils/TestConnection.js', () => ({ TestConnection }));

const { existsSync, mkdirSync, readdirSync, writeFileSync, readFileSync, unlinkSync } = vi.hoisted(() => ({
	existsSync: vi.fn(() => true),
	mkdirSync: vi.fn(),
	readdirSync: vi.fn((): string[] => []),
	writeFileSync: vi.fn(),
	readFileSync: vi.fn((): string => ''),
	unlinkSync: vi.fn()
}));
vi.mock('node:fs', () => ({
	default: {
		existsSync,
		mkdirSync,
		readdirSync,
		writeFileSync,
		readFileSync,
		unlinkSync,
		promises: { writeFile: vi.fn() }
	},
	existsSync,
	mkdirSync,
	readdirSync,
	writeFileSync,
	readFileSync,
	unlinkSync,
	promises: { writeFile: vi.fn() }
}));

const { httpsGet } = vi.hoisted(() => ({ httpsGet: vi.fn() }));
vi.mock('node:https', () => ({ default: { get: httpsGet }, get: httpsGet }));

import { QueueDownload, DownloadAssets, ASSET_TYPE } from '../Utils/Processing/Images.js';
import { EventEmitter } from 'node:events';

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
	readFileSync.mockReset();
	unlinkSync.mockReset();
	httpsGet.mockReset();
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

	it('retries a previously-failed download instead of treating it as a cache hit', async () => {
		TestConnection.mockResolvedValue(true);
		TestConnection.mockResolvedValueOnce(false); // no internet on the first run - asset fails immediately

		const asset = {
			id: '111000000000000002',
			type: ASSET_TYPE.ATTACHMENT,
			name: 'retry.png',
			url: 'https://cdn.discordapp.com/attachments/x/retry.png',
			width: null,
			height: null
		};

		QueueDownload(asset);
		await vi.runOnlyPendingTimersAsync();
		await DownloadAssets();

		expect(writeFileSync).toHaveBeenCalledTimes(1);
		const persisted = writeFileSync.mock.calls[0]![1] as string;

		// second run: LoadFailedDownloads reads the persisted retry cache back in
		readdirSync.mockReturnValueOnce(['retry-batch.json']);
		readFileSync.mockReturnValueOnce(persisted);

		// this time the download succeeds
		httpsGet.mockImplementationOnce((_url: string, _opts: unknown, cb: (response: EventEmitter & { statusCode: number }) => void) => {
			const response = new EventEmitter() as EventEmitter & { statusCode: number, destroy: () => void };
			response.statusCode = 200;
			response.destroy = vi.fn();
			queueMicrotask(() => {
				cb(response);
				response.emit('data', Buffer.from('image-bytes'));
				response.emit('end');
			});
			const request = new EventEmitter() as EventEmitter & { destroy: () => void };
			request.destroy = vi.fn();
			return request;
		});

		await DownloadAssets();

		// a real bug here (RecentURLs marked "seen" before the attempt) would skip the
		// retried URL as a false "cache hit" and never actually call https.get
		expect(httpsGet).toHaveBeenCalledTimes(1);
		expect(batch).toHaveBeenCalled();

		vi.useRealTimers();
	});
});
