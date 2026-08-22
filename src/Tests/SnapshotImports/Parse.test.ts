import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHash } from 'node:crypto';
import { SnapshotExportMetadata } from '../../Typings/DatabaseTypes.js';

const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('../../Database.js', () => ({ Database: { query } }));

const { v1Parse } = vi.hoisted(() => ({ v1Parse: vi.fn((_metadata: unknown, data: unknown) => data) }));
vi.mock('../../Utils/Snapshots/Imports/v1.js', () => ({ default: v1Parse }));
vi.mock('../../Utils/Snapshots/Imports/v2.js', () => ({ default: vi.fn() }));

import { BuildSnapshotFromImport } from '../../Utils/Snapshots/Imports/Parse.js';

function makeMetadata(overrides: Partial<SnapshotExportMetadata> = {}): SnapshotExportMetadata {
	return {
		id: 'ABCD-EFGH-IJKL-MNOP',
		snapshot_id: 1,
		guild_id: 111n,
		user_id: 222n,
		length: 0,
		version: 1,
		hash: 'hash',
		algorithm: 'sha256',
		revoked: 0,
		...overrides
	};
}

beforeEach(() => {
	query.mockReset();
	v1Parse.mockClear();
});

describe('BuildSnapshotFromImport', () => {
	it('re-checks revocation instead of serving a revoked snapshot from cache', async () => {
		const input = { id: 'ABCD-EFGH-IJKL-MNOP', version: 1 };
		const str = JSON.stringify(input);

		// first import: valid and not revoked - gets cached
		query.mockResolvedValueOnce([makeMetadata({ length: str.length, algorithm: 'sha256', hash: hashOf(str) })]);
		await BuildSnapshotFromImport(input);

		// the export is revoked after the fact (e.g. a tampered copy was detected elsewhere)
		query.mockResolvedValueOnce([makeMetadata({ revoked: 1 })]);

		await expect(BuildSnapshotFromImport(input)).rejects.toThrow('Something went wrong trying to parse the snapshot');
	});

	it('serves a cache hit when the snapshot is still valid', async () => {
		const input = { id: 'ABCD-EFGH-IJKL-MNOP-2', version: 1 };
		const str = JSON.stringify(input);
		const metadata = makeMetadata({ id: input.id, length: str.length, algorithm: 'sha256', hash: hashOf(str) });

		query.mockResolvedValue([metadata]);

		await BuildSnapshotFromImport(input);
		await BuildSnapshotFromImport(input);

		expect(v1Parse).toHaveBeenCalledTimes(1); // second call served from cache
	});
});

function hashOf(str: string) {
	return createHash('sha256').update(str).digest('hex');
}
