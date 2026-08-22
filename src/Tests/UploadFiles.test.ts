import { describe, it, expect, vi, beforeEach } from 'vitest';

const { batch, query } = vi.hoisted(() => ({ batch: vi.fn(), query: vi.fn() }));
vi.mock('../Database.js', () => ({ Database: { batch, query } }));

const { existsSync } = vi.hoisted(() => ({ existsSync: vi.fn(() => false) }));
vi.mock('node:fs', () => ({ existsSync }));

import { UploadFiles } from '../Utils/Tasks/UploadFiles.js';

beforeEach(() => {
	batch.mockReset();
	// simulate the real mariadb driver rejecting an empty batch, to prove the guard actually prevents the call
	batch.mockImplementation(async (_sql: string, params: unknown[]) => {
		if (params.length === 0) throw new Error('batch called with empty array');
	});
	query.mockReset();
	existsSync.mockReset().mockReturnValue(false); // no files on disk to upload
});

describe('UploadFiles', () => {
	it('does not call Database.batch with an empty array when there is nothing to upload', async () => {
		query.mockResolvedValue([]); // no pending assets

		await expect(UploadFiles()).resolves.not.toThrow();

		expect(batch).not.toHaveBeenCalled();
	});
});
