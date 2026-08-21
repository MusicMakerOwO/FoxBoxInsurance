import { describe, it, expect, vi, beforeEach } from 'vitest';

type SnapshotRow = { id: number, guild_id: bigint, type: number, pinned: 0 | 1 };

const { query, getConnection, releaseConnection } = vi.hoisted(() => ({
	query: vi.fn(),
	getConnection: vi.fn(),
	releaseConnection: vi.fn()
}));
vi.mock('../Database.js', () => ({ Database: { query, getConnection, releaseConnection } }));

import {
	MaxSnapshotsForGuild,
	DeleteSnapshot,
	SetSnapshotPinStatus,
	isSnapshotQueuedForDeletion,
	IsSnapshotDeletable,
	GetSnapshot
} from '../CRUD/Snapshots.js';

// Snapshot/guild IDs must stay disjoint across tests - GetSnapshot/ResolveGuildFromSnapshotID
// cache results in module-level maps that persist for the life of this test file.
function seed(snapshots: SnapshotRow[]) {
	query.mockImplementation(async (sql: string, params: unknown[] = []) => {
		if (sql.includes('FROM Snapshots') && sql.includes('WHERE guild_id')) {
			return snapshots.filter(s => s.guild_id === params[0]).sort((a, b) => a.id - b.id);
		}
		if (sql.includes('FROM Snapshots') && sql.includes('WHERE id')) {
			const row = snapshots.find(s => s.id === params[0]);
			return row ? [row] : [];
		}
		if (sql.includes('UPDATE Snapshots SET pinned')) {
			const [pinned, id] = params as [boolean, number];
			const row = snapshots.find(s => s.id === id);
			if (row) row.pinned = pinned ? 1 : 0;
			return { affectedRows: row ? 1n : 0n };
		}
		if (sql.includes('FROM SnapshotRoles') || sql.includes('FROM SnapshotChannels') || sql.includes('FROM SnapshotBans')) {
			return [];
		}
		throw new Error(`Unhandled mock query: ${sql}`);
	});
	getConnection.mockResolvedValue({ query });
}

beforeEach(() => {
	query.mockReset();
	getConnection.mockReset();
	releaseConnection.mockReset();
});

describe('Snapshots', () => {
	it('only saves 7 snapshots per server', async () => {
		expect(await MaxSnapshotsForGuild(1n)).toBe(7);
	});

	it('does not allow pinned snapshots to be deleted', async () => {
		seed([{ id: 201, guild_id: 101n, type: 0, pinned: 1 }]);

		await expect(DeleteSnapshot(201)).rejects.toThrow('Cannot delete a pinned snapshot');
	});

	it('cannot pin more snapshots than the maximum snapshots', async () => {
		const pinned: SnapshotRow[] = Array.from({ length: 7 }, (_, i) => ({ id: 301 + i, guild_id: 102n, type: 0, pinned: 1 }));
		seed([...pinned, { id: 308, guild_id: 102n, type: 0, pinned: 0 }]);

		await expect(SetSnapshotPinStatus(308, true)).rejects.toThrow('Cannot pin snapshot - Slots are already full');
	});

	it('queues snapshots for deletion that are not pinned', async () => {
		const snapshots: SnapshotRow[] = [
			{ id: 401, guild_id: 103n, type: 0, pinned: 1 }, // pinned - protected from deletion
			...Array.from({ length: 8 }, (_, i): SnapshotRow => ({ id: 402 + i, guild_id: 103n, type: 0, pinned: 0 }))
		];
		seed(snapshots);

		expect(await isSnapshotQueuedForDeletion(401)).toBe(false);
		expect(await isSnapshotQueuedForDeletion(402)).toBe(true);
	});

	it('marks unpinned snapshots as deletable', async () => {
		seed([{ id: 501, guild_id: 104n, type: 0, pinned: 0 }]);

		expect(await IsSnapshotDeletable(501)).toBe(true);
	});

	it('queues deletion from oldest snapshots first', async () => {
		const snapshots: SnapshotRow[] = Array.from({ length: 9 }, (_, i) => ({ id: 601 + i, guild_id: 105n, type: 0, pinned: 0 }));
		seed(snapshots);

		expect(await isSnapshotQueuedForDeletion(601)).toBe(true); // oldest of the 2-snapshot overflow
		expect(await isSnapshotQueuedForDeletion(609)).toBe(false); // newest, within the 7-snapshot limit
	});

	it('returns null if a given snapshot does not exist', async () => {
		seed([{ id: 701, guild_id: 106n, type: 0, pinned: 0 }]);

		expect(await GetSnapshot(999)).toBeNull();
	});
});
