import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Database } from '../../Database.js';
import {
	CreateRestoreRun,
	FinishRestoreRun,
	GetRestoreActions,
	GetRestoreRun,
	HydratePayload,
	ListRunningRestores,
	MarkRunningRestoresInterrupted,
	NewRestoreAction,
	NewRestoreRun,
	RecordActionResult,
	ReopenRestoreRun,
	SkipRestoreActions
} from '../../CRUD/SnapshotRestores.js';
import { DIFF_CHANGE_TYPE, RESTORE_OPTIONS, RESTORE_RESULT, RESTORE_STATUS, SNAPSHOT_TYPE } from '../../Utils/Constants.js';

// RehydrateRemap is a pure function, but it lives in RestoreRunner.ts, which imports the real
// discord.js client from Client.js at module scope - mock it like every other consumer of
// RestoreRunner.ts does, purely to satisfy that import (this file's real-DB nature is unaffected).
vi.mock('../../Client.js');
const { RehydrateRemap } = await import('../../Services/RestoreRunner.js');

/**
 * This is the only test file in the repo that talks to a real database instead of mocking
 * `../../Database.js` - `CRUD/SnapshotRestores.ts` hand-rolls bigint<->JSON coercion on the
 * `payload` column (`SerializePayload`/`HydratePayload`), and only a real round trip through
 * MariaDB's JSON column and driver can verify that survives.
 *
 * Every test gets its own throwaway `Guilds` row (a high, timestamp-derived ID kept well outside
 * real Discord snowflake range) and deletes it in `afterEach` - the `ON DELETE CASCADE` on
 * `SnapshotRestores.guild_id` takes every run and action row with it, so no per-row cleanup is
 * needed. `snapshot_id`/`safety_snapshot_id` are deliberately FK-less, so no `Snapshots` row is
 * required to satisfy them.
 */

let guildCounter = 0n;
const TEST_GUILD_BASE = 900_000_000_000_000_000n + BigInt(Date.now());
function nextGuildID(): bigint {
	return TEST_GUILD_BASE + guildCounter++;
}

async function makeGuild(): Promise<bigint> {
	const id = nextGuildID();
	await Database.query('INSERT INTO Guilds (id, name, features) VALUES (?, ?, ?)', [id, 'Restore CRUD test guild', 0]);
	return id;
}

async function deleteGuild(id: bigint): Promise<void> {
	await Database.query('DELETE FROM Guilds WHERE id = ?', [id]);
}

function baseRun(guildID: bigint): NewRestoreRun {
	return {
		guild_id: guildID,
		snapshot_id: 1,
		import_id: null,
		safety_snapshot_id: null,
		user_id: 42n,
		channel_id: 43n,
		mask: RESTORE_OPTIONS.CHANNELS | RESTORE_OPTIONS.ROLES | RESTORE_OPTIONS.BANS
	};
}

let guildID: bigint;
beforeEach(async () => {
	guildID = await makeGuild();
});
afterEach(async () => {
	await deleteGuild(guildID);
});

describe('HydratePayload', () => {
	it('tolerates a raw JSON string, as if the driver had not parsed the LONGTEXT column', () => {
		const raw = JSON.stringify({ id: '456', name: 'Test Role', color: 0, hoist: 0, position: 1, permissions: '8', managed_by: null });
		const payload = HydratePayload(RESTORE_OPTIONS.ROLES, raw);
		expect(payload).toEqual({ id: 456n, name: 'Test Role', color: 0, hoist: 0, position: 1, permissions: 8n, managed_by: null });
	});
});

describe('CreateRestoreRun / GetRestoreActions - payload round-trip', () => {
	it('round-trips a role payload, including bigint types (id, permissions, managed_by)', async () => {
		const action: NewRestoreAction = {
			category: RESTORE_OPTIONS.ROLES,
			change_type: DIFF_CHANGE_TYPE.CREATE,
			target_id: 456n,
			label: '@Test Role',
			payload: {
				id: 456n,
				name: 'Test Role',
				color: 0,
				hoist: 0,
				position: 1,
				permissions: 8n,
				managed_by: 123n
			}
		};

		const restoreID = await CreateRestoreRun(baseRun(guildID), [action]);
		const [row] = await GetRestoreActions(restoreID);

		expect(row.payload).toEqual(action.payload);
		expect(typeof (row.payload as { id: unknown }).id).toBe('bigint');
		expect(typeof (row.payload as { permissions: unknown }).permissions).toBe('bigint');
		expect(typeof (row.payload as { managed_by: unknown }).managed_by).toBe('bigint');
	});

	it('round-trips a channel payload - id/parent_id as bigint, overwrite allow/deny as strings, nsfw/position/type intact', async () => {
		const action: NewRestoreAction = {
			category: RESTORE_OPTIONS.CHANNELS,
			change_type: DIFF_CHANGE_TYPE.CREATE,
			target_id: 789n,
			label: '#test-channel',
			payload: {
				id: 789n,
				type: 0,
				name: 'test-channel',
				position: 2,
				topic: 'hello',
				nsfw: 1,
				parent_id: 111n,
				permission_overwrites: {
					'222': { allow: '8', deny: '0', type: 0 }
				}
			}
		};

		const restoreID = await CreateRestoreRun(baseRun(guildID), [action]);
		const [row] = await GetRestoreActions(restoreID);
		const payload = row.payload as Extract<typeof row.payload, { parent_id: unknown }>;

		expect(payload.id).toBe(789n);
		expect(typeof payload.id).toBe('bigint');
		expect(payload.parent_id).toBe(111n);
		expect(typeof payload.parent_id).toBe('bigint');
		expect(payload.nsfw).toBe(1);
		expect(payload.position).toBe(2);
		expect(payload.type).toBe(0);
		// Nested overwrite bigints are not re-hydrated by category - they stay strings, per
		// StoredRestorePayload's shape (only the top-level per-entity fields are coerced back).
		expect(payload.permission_overwrites['222']).toEqual({ allow: '8', deny: '0', type: 0 });
	});

	it('round-trips a ban payload - id as bigint, reason intact', async () => {
		const action: NewRestoreAction = {
			category: RESTORE_OPTIONS.BANS,
			change_type: DIFF_CHANGE_TYPE.CREATE,
			target_id: 321n,
			label: 'Banned User',
			payload: { id: 321n, reason: 'raided the server' }
		};

		const restoreID = await CreateRestoreRun(baseRun(guildID), [action]);
		const [row] = await GetRestoreActions(restoreID);
		const payload = row.payload as { id: bigint, reason: string };

		expect(payload.id).toBe(321n);
		expect(typeof payload.id).toBe('bigint');
		expect(payload.reason).toBe('raided the server');
	});

	it('keeps parent_id null, not 0n, when the payload has no parent', async () => {
		const action: NewRestoreAction = {
			category: RESTORE_OPTIONS.CHANNELS,
			change_type: DIFF_CHANGE_TYPE.CREATE,
			target_id: 790n,
			label: '#root-channel',
			payload: {
				id: 790n, type: 0, name: 'root-channel', position: 0,
				topic: null, nsfw: 0, parent_id: null, permission_overwrites: {}
			}
		};

		const restoreID = await CreateRestoreRun(baseRun(guildID), [action]);
		const [row] = await GetRestoreActions(restoreID);

		expect((row.payload as { parent_id: unknown }).parent_id).toBeNull();
	});

	it('keeps managed_by null when the role payload has no managing entity', async () => {
		const action: NewRestoreAction = {
			category: RESTORE_OPTIONS.ROLES,
			change_type: DIFF_CHANGE_TYPE.CREATE,
			target_id: 457n,
			label: '@Unmanaged Role',
			payload: { id: 457n, name: 'Unmanaged Role', color: 0, hoist: 0, position: 1, permissions: 0n, managed_by: null }
		};

		const restoreID = await CreateRestoreRun(baseRun(guildID), [action]);
		const [row] = await GetRestoreActions(restoreID);

		expect((row.payload as { managed_by: unknown }).managed_by).toBeNull();
	});

	it('stores a DELETE action payload as NULL and hydrates it back as null', async () => {
		const action: NewRestoreAction = {
			category: RESTORE_OPTIONS.CHANNELS,
			change_type: DIFF_CHANGE_TYPE.DELETE,
			target_id: 791n,
			label: '#deleted-channel',
			payload: null
		};

		const restoreID = await CreateRestoreRun(baseRun(guildID), [action]);
		const [row] = await GetRestoreActions(restoreID);

		expect(row.payload).toBeNull();
	});
});

describe('CreateRestoreRun - atomicity and shape', () => {
	it('is atomic: a failure while serializing an action leaves no orphan run row', async () => {
		const circular: Record<string, unknown> = {};
		circular.self = circular;
		const action: NewRestoreAction = {
			category: RESTORE_OPTIONS.BANS,
			change_type: DIFF_CHANGE_TYPE.CREATE,
			target_id: 1n,
			label: 'circular',
			// Not a valid SnapshotRestorePayload - deliberately forces JSON.stringify to throw
			// inside the transaction, after the run row's INSERT has already run on the same
			// (uncommitted) connection, to prove the whole thing rolls back together.
			payload: circular as never
		};

		await expect(CreateRestoreRun(baseRun(guildID), [action])).rejects.toThrow();

		const rows = await Database.query('SELECT * FROM SnapshotRestores WHERE guild_id = ?', [guildID]);
		expect(rows).toHaveLength(0);
	});

	it('creates a run with zero actions - total_actions = 0, the action batch is skipped', async () => {
		const restoreID = await CreateRestoreRun(baseRun(guildID), []);

		const run = await GetRestoreRun(restoreID);
		expect(run!.total_actions).toBe(0);

		const actions = await GetRestoreActions(restoreID);
		expect(actions).toHaveLength(0);
	});

	it('persists rows in exactly the plan order (seq = array index)', async () => {
		const actions: NewRestoreAction[] = Array.from({ length: 5 }, (_, i) => ({
			category: RESTORE_OPTIONS.BANS,
			change_type: DIFF_CHANGE_TYPE.CREATE,
			target_id: BigInt(100 + i),
			label: `ban-${i}`,
			payload: { id: BigInt(100 + i), reason: 'test' }
		}));

		const restoreID = await CreateRestoreRun(baseRun(guildID), actions);
		const rows = await GetRestoreActions(restoreID);

		expect(rows.map(r => r.label)).toEqual(['ban-0', 'ban-1', 'ban-2', 'ban-3', 'ban-4']);
		expect(rows.map(r => r.seq)).toEqual([0, 1, 2, 3, 4]);
	});

	it('truncates a label at 200 characters (VARCHAR(200)) without erroring', async () => {
		const longLabel = '#' + 'x'.repeat(300);
		const restoreID = await CreateRestoreRun(baseRun(guildID), [{
			category: RESTORE_OPTIONS.CHANNELS,
			change_type: DIFF_CHANGE_TYPE.DELETE,
			target_id: 1n,
			label: longLabel,
			payload: null
		}]);

		const [row] = await GetRestoreActions(restoreID);
		expect(row.label).toBe(longLabel.slice(0, 200));
		expect(row.label).toHaveLength(200);
	});

	it('discriminates snapshot_id vs import_id and round-trips the correct type for each', async () => {
		const snapshotRunID = await CreateRestoreRun({ ...baseRun(guildID), snapshot_id: 5, import_id: null }, []);
		const importRunID = await CreateRestoreRun({ ...baseRun(guildID), snapshot_id: null, import_id: 'ABCD-1234' }, []);

		const snapshotRun = await GetRestoreRun(snapshotRunID);
		expect(snapshotRun!.snapshot_id).toBe(5);
		expect(snapshotRun!.import_id).toBeNull();

		const importRun = await GetRestoreRun(importRunID);
		expect(importRun!.snapshot_id).toBeNull();
		expect(importRun!.import_id).toBe('ABCD-1234');
	});
});

describe('RecordActionResult / GetRestoreActions filtering', () => {
	it('truncates a recorded error at 500 characters', async () => {
		const restoreID = await CreateRestoreRun(baseRun(guildID), [{
			category: RESTORE_OPTIONS.ROLES, change_type: DIFF_CHANGE_TYPE.UPDATE, target_id: 1n, label: '@role', payload: null
		}]);
		const longError = 'E'.repeat(2000);

		await RecordActionResult(restoreID, 0, RESTORE_RESULT.FAILED, null, longError);
		const [row] = await GetRestoreActions(restoreID);

		expect(row.error).toBe(longError.slice(0, 500));
		expect(row.error).toHaveLength(500);
	});

	it('updates only the targeted (restore_id, seq) row, leaving siblings untouched', async () => {
		const restoreID = await CreateRestoreRun(baseRun(guildID), [
			{ category: RESTORE_OPTIONS.ROLES, change_type: DIFF_CHANGE_TYPE.CREATE, target_id: 1n, label: 'r1', payload: null },
			{ category: RESTORE_OPTIONS.ROLES, change_type: DIFF_CHANGE_TYPE.CREATE, target_id: 2n, label: 'r2', payload: null }
		]);

		await RecordActionResult(restoreID, 0, RESTORE_RESULT.OK, 999n, null);
		const rows = await GetRestoreActions(restoreID);

		expect(rows[0].result).toBe(RESTORE_RESULT.OK);
		expect(rows[0].new_id).toBe(999n);
		expect(rows[1].result).toBe(RESTORE_RESULT.PENDING);
		expect(rows[1].new_id).toBeNull();
	});

	it('filters GetRestoreActions by result, staying seq-ordered', async () => {
		const restoreID = await CreateRestoreRun(baseRun(guildID), [
			{ category: RESTORE_OPTIONS.BANS, change_type: DIFF_CHANGE_TYPE.CREATE, target_id: 1n, label: 'a', payload: null },
			{ category: RESTORE_OPTIONS.BANS, change_type: DIFF_CHANGE_TYPE.CREATE, target_id: 2n, label: 'b', payload: null },
			{ category: RESTORE_OPTIONS.BANS, change_type: DIFF_CHANGE_TYPE.CREATE, target_id: 3n, label: 'c', payload: null }
		]);

		await RecordActionResult(restoreID, 0, RESTORE_RESULT.OK);
		await RecordActionResult(restoreID, 1, RESTORE_RESULT.FAILED, null, 'boom-1');
		await RecordActionResult(restoreID, 2, RESTORE_RESULT.FAILED, null, 'boom-2');

		const failed = await GetRestoreActions(restoreID, RESTORE_RESULT.FAILED);
		expect(failed.map(a => a.label)).toEqual(['b', 'c']);
		expect(failed.every(a => a.result === RESTORE_RESULT.FAILED)).toBe(true);
	});
});

describe('SkipRestoreActions', () => {
	/** `n` bare actions, so a run can be seeded at whatever size a case needs */
	function actions(count: number): NewRestoreAction[] {
		return Array.from({ length: count }, (_, index) => ({
			category   : RESTORE_OPTIONS.ROLES,
			change_type: DIFF_CHANGE_TYPE.CREATE,
			target_id  : BigInt(index + 1),
			label      : `r${index}`,
			payload    : null
		}));
	}

	it('skips only the listed seqs and clears their new_id', async () => {
		const restoreID = await CreateRestoreRun(baseRun(guildID), actions(4));

		await RecordActionResult(restoreID, 1, RESTORE_RESULT.FAILED, 777n, 'boom');
		await SkipRestoreActions(restoreID, [1, 3], 'stopped before this action ran');

		const rows = await GetRestoreActions(restoreID);

		expect(rows.map(a => a.result)).toEqual([
			RESTORE_RESULT.PENDING, RESTORE_RESULT.SKIPPED, RESTORE_RESULT.PENDING, RESTORE_RESULT.SKIPPED
		]);
		expect(rows[1].error).toBe('stopped before this action ran');
		expect(rows[1].new_id).toBeNull(); // the failed attempt's id must not survive the skip
		expect(rows[0].error).toBeNull();
	});

	it('truncates the error at 500 characters, like RecordActionResult', async () => {
		const restoreID = await CreateRestoreRun(baseRun(guildID), actions(1));
		const longError = 'E'.repeat(2000);

		await SkipRestoreActions(restoreID, [0], longError);
		const [row] = await GetRestoreActions(restoreID);

		expect(row.error).toHaveLength(500);
	});

	it('is a no-op for an empty seq list', async () => {
		const restoreID = await CreateRestoreRun(baseRun(guildID), actions(2));

		await SkipRestoreActions(restoreID, [], 'stopped before this action ran');
		const rows = await GetRestoreActions(restoreID);

		expect(rows.every(a => a.result === RESTORE_RESULT.PENDING)).toBe(true);
	});

	// The whole point of the helper is draining a large plan in as few round trips as possible, so the
	// case that spills past one `IN (...)` list has to update every row, not just the first chunk
	it('updates every row when the seq list spans more than one chunk', async () => {
		const total = 1201; // > 2 chunks of 500
		const restoreID = await CreateRestoreRun(baseRun(guildID), actions(total));

		await SkipRestoreActions(restoreID, Array.from({ length: total }, (_, index) => index), 'stopped');
		const rows = await GetRestoreActions(restoreID);

		expect(rows).toHaveLength(total);
		expect(rows.every(a => a.result === RESTORE_RESULT.SKIPPED)).toBe(true);
	});
});

describe('RehydrateRemap - db round trip', () => {
	it('rebuilds target_id -> new_id from real rows, for a retry re-parenting through a recreated category', async () => {
		const categoryID = 500n;
		const newCategoryID = 999n;

		const restoreID = await CreateRestoreRun(baseRun(guildID), [
			{
				category: RESTORE_OPTIONS.CHANNELS, change_type: DIFF_CHANGE_TYPE.CREATE, target_id: categoryID,
				label: '#category', payload: { id: categoryID, type: 4, name: 'category', position: 0, topic: null, nsfw: 0, parent_id: null, permission_overwrites: {} }
			},
			{
				category: RESTORE_OPTIONS.CHANNELS, change_type: DIFF_CHANGE_TYPE.CREATE, target_id: 501n,
				label: '#child', payload: { id: 501n, type: 0, name: 'child', position: 0, topic: null, nsfw: 0, parent_id: categoryID, permission_overwrites: {} }
			}
		]);

		// seq 0 (the category) succeeded on the first attempt and got a real new snowflake.
		await RecordActionResult(restoreID, 0, RESTORE_RESULT.OK, newCategoryID);
		// seq 1 (the child) failed before it could be created, so it never received a new_id.
		await RecordActionResult(restoreID, 1, RESTORE_RESULT.FAILED, null, 'boom');

		const actions = await GetRestoreActions(restoreID);
		const remap = RehydrateRemap(actions);

		expect(remap.get(categoryID)).toBe(newCategoryID);
		expect(remap.has(501n)).toBe(false);
	});
});

describe('Run lifecycle - FinishRestoreRun / ReopenRestoreRun', () => {
	it('FinishRestoreRun sets status, applied_actions and finished_at', async () => {
		const restoreID = await CreateRestoreRun(baseRun(guildID), []);
		expect((await GetRestoreRun(restoreID))!.finished_at).toBeNull();

		await FinishRestoreRun(restoreID, RESTORE_STATUS.COMPLETE, 5);
		const run = await GetRestoreRun(restoreID);

		expect(run!.status).toBe(RESTORE_STATUS.COMPLETE);
		expect(run!.applied_actions).toBe(5);
		expect(run!.finished_at).not.toBeNull();
		expect(typeof run!.finished_at).toBe('bigint');
	});

	it('ReopenRestoreRun puts a finished run back to RUNNING and clears finished_at', async () => {
		const restoreID = await CreateRestoreRun(baseRun(guildID), []);
		await FinishRestoreRun(restoreID, RESTORE_STATUS.FAILED, 0);

		await ReopenRestoreRun(restoreID);
		const run = await GetRestoreRun(restoreID);

		expect(run!.status).toBe(RESTORE_STATUS.RUNNING);
		expect(run!.finished_at).toBeNull();
	});
});

describe('ListRunningRestores', () => {
	it('returns only status = RUNNING runs, and not this guild\'s finished run', async () => {
		const runningID = await CreateRestoreRun(baseRun(guildID), []);
		const finishedID = await CreateRestoreRun(baseRun(guildID), []);
		await FinishRestoreRun(finishedID, RESTORE_STATUS.COMPLETE, 0);

		const running = await ListRunningRestores();
		const ids = running.map(r => r.id);

		expect(ids).toContain(runningID);
		expect(ids).not.toContain(finishedID);
		expect(running.every(r => r.status === RESTORE_STATUS.RUNNING)).toBe(true);
	});
});

describe('FK cascade', () => {
	it('deleting the Guilds row deletes the run and its actions', async () => {
		const restoreID = await CreateRestoreRun(baseRun(guildID), [
			{ category: RESTORE_OPTIONS.BANS, change_type: DIFF_CHANGE_TYPE.CREATE, target_id: 1n, label: 'a', payload: null }
		]);

		await deleteGuild(guildID);

		const runRows = await Database.query('SELECT * FROM SnapshotRestores WHERE id = ?', [restoreID]);
		const actionRows = await Database.query('SELECT * FROM SnapshotRestoreActions WHERE restore_id = ?', [restoreID]);
		expect(runRows).toHaveLength(0);
		expect(actionRows).toHaveLength(0);

		// afterEach's deleteGuild(guildID) is now a no-op DELETE against an already-gone row - fine.
	});
});

/**
 * §14: a retry replays the payloads on `SnapshotRestoreActions`, which is only true for as long as
 * deleting the source snapshot leaves those rows alone.
 *
 * `SnapshotRoles`/`SnapshotChannels`/`SnapshotBans` all cascade from `Snapshots(id)`; `SnapshotRestores`
 * deliberately does not - it has a foreign key on `guild_id` only, so `snapshot_id` and
 * `safety_snapshot_id` are plain columns. That asymmetry is the whole guarantee, and a later migration
 * adding the "missing" foreign key would break retry silently, which is why it is pinned here rather
 * than left to a live-bot check.
 */
describe('source snapshot deletion', () => {
	async function makeSnapshot(): Promise<number> {
		const result = await Database.query(
			'INSERT INTO Snapshots (guild_id, type, pinned) VALUES (?, ?, 0)',
			[guildID, SNAPSHOT_TYPE.MANUAL]
		) as { insertId: bigint };

		return Number(result.insertId);
	}

	it('leaves the run row and its payloads intact when the snapshot it came from is deleted', async () => {
		const snapshotID = await makeSnapshot();

		const restoreID = await CreateRestoreRun({ ...baseRun(guildID), snapshot_id: snapshotID }, [
			{
				category: RESTORE_OPTIONS.ROLES, change_type: DIFF_CHANGE_TYPE.CREATE, target_id: 600n,
				label: '@Admin',
				payload: { id: 600n, name: 'Admin', color: 0xFF00FF, hoist: 1, position: 7, permissions: 8n, managed_by: null }
			},
			{
				category: RESTORE_OPTIONS.CHANNELS, change_type: DIFF_CHANGE_TYPE.CREATE, target_id: 601n,
				label: '#logs',
				payload: { id: 601n, type: 0, name: 'logs', position: 0, topic: null, nsfw: 0, parent_id: 602n, permission_overwrites: {} }
			}
		]);

		const before = await GetRestoreActions(restoreID);
		await Database.query('DELETE FROM Snapshots WHERE id = ?', [snapshotID]);

		const run = await GetRestoreRun(restoreID);
		expect(run).not.toBeNull();
		// Not cascaded away, and not nulled out either - `RunLabel` still renders "Snapshot #N"
		expect(run!.snapshot_id).toBe(snapshotID);
		expect(run!.total_actions).toBe(2);

		const after = await GetRestoreActions(restoreID);
		expect(after).toEqual(before);
		// The parent a retry re-parents through lives in the payload, not in the deleted snapshot
		expect((after[1].payload as { parent_id: unknown }).parent_id).toBe(602n);
	});

	it('does cascade the snapshot\'s own entity rows, which is what makes the run rows the exception', async () => {
		const snapshotID = await makeSnapshot();
		await Database.query(
			'INSERT INTO SnapshotRoles (snapshot_id, id, name, color, position, hoist, permissions) VALUES (?, ?, ?, ?, ?, ?, ?)',
			[snapshotID, 700n, 'Admin', 0, 1, 0, 8n]
		);

		const restoreID = await CreateRestoreRun({ ...baseRun(guildID), snapshot_id: snapshotID }, [
			{ category: RESTORE_OPTIONS.ROLES, change_type: DIFF_CHANGE_TYPE.CREATE, target_id: 700n, label: '@Admin', payload: null }
		]);

		await Database.query('DELETE FROM Snapshots WHERE id = ?', [snapshotID]);

		const roleRows = await Database.query('SELECT * FROM SnapshotRoles WHERE snapshot_id = ?', [snapshotID]);
		expect(roleRows).toHaveLength(0);

		expect(await GetRestoreRun(restoreID)).not.toBeNull();
		expect(await GetRestoreActions(restoreID)).toHaveLength(1);
	});

	it('leaves a run whose safety snapshot was rotated away readable, minus the way back', async () => {
		const safetyID = await makeSnapshot();
		const restoreID = await CreateRestoreRun({ ...baseRun(guildID), safety_snapshot_id: safetyID }, []);

		// `safety_snapshot_id` is FK-less for the same reason, but a different one: DB_SETUP.sql notes
		// the snapshot may be unpinned and rotated away long after the run finished
		await Database.query('DELETE FROM Snapshots WHERE id = ?', [safetyID]);

		const run = await GetRestoreRun(restoreID);
		expect(run!.safety_snapshot_id).toBe(safetyID);
	});
});

describe('MarkRunningRestoresInterrupted', () => {
	/**
	 * This function has no guild filter - it interrupts every RUNNING run in the database. Against
	 * a shared/real local dev DB (see the file-level comment) that is only safe to exercise if
	 * nothing outside this test's own guild is actually RUNNING right now. Guard rather than assume.
	 */
	it('interrupts PENDING actions to SKIPPED and the run to INTERRUPTED, leaves finished runs alone', async () => {
		const runningID = await CreateRestoreRun(baseRun(guildID), [
			{ category: RESTORE_OPTIONS.BANS, change_type: DIFF_CHANGE_TYPE.CREATE, target_id: 1n, label: 'a', payload: null },
			{ category: RESTORE_OPTIONS.BANS, change_type: DIFF_CHANGE_TYPE.CREATE, target_id: 2n, label: 'b', payload: null }
		]);
		await RecordActionResult(runningID, 0, RESTORE_RESULT.OK);
		// seq 1 is left PENDING on purpose

		const finishedID = await CreateRestoreRun(baseRun(guildID), [
			{ category: RESTORE_OPTIONS.BANS, change_type: DIFF_CHANGE_TYPE.CREATE, target_id: 3n, label: 'c', payload: null }
		]);
		await RecordActionResult(finishedID, 0, RESTORE_RESULT.OK);
		await FinishRestoreRun(finishedID, RESTORE_STATUS.COMPLETE, 1);

		const otherRunning = (await ListRunningRestores()).filter(r => r.id !== runningID);
		if (otherRunning.length > 0) {
			throw new Error(
				`Refusing to run MarkRunningRestoresInterrupted: ${otherRunning.length} RUNNING restore(s) ` +
				`exist outside this test (guild(s): ${otherRunning.map(r => r.guild_id).join(', ')}). ` +
				'This function has no guild filter and would interrupt real, unrelated restores. ' +
				'Re-run once nothing else is actually restoring against this database.'
			);
		}

		await MarkRunningRestoresInterrupted();

		const runningRun = await GetRestoreRun(runningID);
		expect(runningRun!.status).toBe(RESTORE_STATUS.INTERRUPTED);
		expect(runningRun!.finished_at).not.toBeNull();

		const runningActions = await GetRestoreActions(runningID);
		expect(runningActions[0].result).toBe(RESTORE_RESULT.OK); // untouched - was already OK
		expect(runningActions[1].result).toBe(RESTORE_RESULT.SKIPPED); // was PENDING

		const finishedRun = await GetRestoreRun(finishedID);
		expect(finishedRun!.status).toBe(RESTORE_STATUS.COMPLETE); // untouched
		const finishedActions = await GetRestoreActions(finishedID);
		expect(finishedActions[0].result).toBe(RESTORE_RESULT.OK); // untouched
	});

	it('is a no-op when no other RUNNING rows exist for this guild', async () => {
		const otherRunning = await ListRunningRestores();
		if (otherRunning.length > 0) {
			throw new Error(
				`Refusing to run MarkRunningRestoresInterrupted: ${otherRunning.length} RUNNING restore(s) ` +
				'exist outside this test. This function has no guild filter.'
			);
		}

		await expect(MarkRunningRestoresInterrupted()).resolves.toBeUndefined();
	});
});
