import * as dotenv from "dotenv";
dotenv.config({ path: `${__dirname}/../../.env`, quiet: true });

import { vi, describe, it, expect, afterAll } from 'vitest';
import {
	DeleteSnapshot, GetSnapshot, IsSnapshotDeletable,
	isSnapshotQueuedForDeletion,
	MaxSnapshotsForGuild,
	SetSnapshotPinStatus
} from "../CRUD/Snapshots";
import { Database } from "../Database";
import { SNAPSHOT_TYPE } from "../Utils/Constants";
import { GUILD_FEATURES } from "../Typings/DatabaseTypes";

// @ts-ignore
vi.mock(import('../Client.js'), () => ({
	client: {
		user: {
			id: '1089343117142020319',
		}
	}
}))

const TEST_GUILD_ID = 1n;

describe('Snapshots', async () => {

	await Database.query('INSERT INTO Guilds (id, name, features) VALUES (?, ?, ?)', [TEST_GUILD_ID, 'Test Server', Object.values(GUILD_FEATURES).reduce( (x, y) => x | y, 0)]);

	// create 8 dummy snapshots with no data
	for (let i = 0; i < 8; i++) {
		// Pin all but the last one
		await Database.query(`INSERT INTO Snapshots (guild_id, type, pinned) VALUES (?, ?, ?)`, [TEST_GUILD_ID, SNAPSHOT_TYPE.MANUAL, i < 7]);
	}

	const SNAPSHOT_IDs = await Database.query(`SELECT id FROM Snapshots WHERE guild_id = ?`, [TEST_GUILD_ID]).then((x: { id: number }[]) => x.map(y => y.id)) as number[];
	const lastSnapshotID = SNAPSHOT_IDs[ SNAPSHOT_IDs.length - 1 ];

	it('only saves 7 snapshots per server', async () => {
		const maxSnapshots = await MaxSnapshotsForGuild(TEST_GUILD_ID);
		expect(maxSnapshots).toBe(7);
	});

	it('does not allow pinned snapshots to be deleted', async () => {
		await expect( () => DeleteSnapshot(SNAPSHOT_IDs[0]) ).rejects.toThrow("Cannot delete a pinned snapshot");
	})

	it('cannot pin more snapshots than the maximum snapshots', async () => {
		await expect( () => SetSnapshotPinStatus(lastSnapshotID, true) ).rejects.toThrow('Cannot pin snapshot - Slots are already full');
	})

	it('queues snapshots for deletion that are not pinned', async () => {
		const queuedPin = await isSnapshotQueuedForDeletion(SNAPSHOT_IDs[0]);
		const queuesUnpinned = await isSnapshotQueuedForDeletion(lastSnapshotID);
		expect(queuedPin).toBe(false);
		expect(queuesUnpinned).toBe(true);
	})

	it('marks unpinned snapshots as deletable', async () => {
		const deletePin = await IsSnapshotDeletable(SNAPSHOT_IDs[0]);
		const deleteUnpinned = await IsSnapshotDeletable(lastSnapshotID);
		expect(deletePin).toBe(false);
		expect(deleteUnpinned).toBe(true);
	})

	it('returns null if a given snapshot does not exist', async () => {
		const invalid = await GetSnapshot(-1);
		expect(invalid).toBeNull()
	})

	afterAll( async () => {
		await Database.query('DELETE FROM Snapshots WHERE guild_id = ?', [TEST_GUILD_ID]);
		await Database.query('DELETE FROM Guilds WHERE id = ?', [TEST_GUILD_ID]);
		await Database.destroy();
	});
})