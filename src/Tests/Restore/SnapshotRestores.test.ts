import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DIFF_CHANGE_TYPE, RESTORE_OPTIONS, RESTORE_RESULT, RESTORE_STATUS } from '../../Utils/Constants.js';

/**
 * §7 of the restore test plan: `CRUD/SnapshotRestores.ts`, which hand-rolls bigint<->JSON coercion
 * on the `payload` column (`SerializePayload`/`HydratePayload`) and does its own truncation and
 * chunking on the way to the database.
 *
 * `../../Database.js` is mocked, like everywhere else in the suite - but with an in-memory store
 * rather than bare spies, because a spy cannot show a payload surviving the trip out and back. The
 * fake keeps `payload` as **the JSON text the code handed it**, never the live object, so hydration
 * really parses. MariaDB's `JSON` type is LONGTEXT and the driver parses it for us by default;
 * `store.parseJSONColumn` flips that off to exercise the `typeof stored === 'string'` branch.
 *
 * What the fake cannot speak to is MariaDB's own behavior - column-level truncation, `ON DELETE
 * CASCADE`, `JSON_VALID`. Those are schema guarantees rather than guarantees about this module, and
 * are pinned against `DB_SETUP.sql` in `DBSchemaGuards.test.ts` instead.
 */

const { store, Database } = vi.hoisted(() => {
	type Row = Record<string, unknown>;

	const store = {
		runs   : [] as Row[],
		actions: [] as Row[],
		nextRunID: 1,
		/** Whether the driver parses the JSON column for us. True is the real default */
		parseJSONColumn: true,
		commits  : 0,
		rollbacks: 0,
		reset() {
			store.runs = [];
			store.actions = [];
			store.nextRunID = 1;
			store.parseJSONColumn = true;
			store.commits = 0;
			store.rollbacks = 0;
		}
	};

	/** Reads hand back copies, so a test holding a result cannot reach into the store through it */
	function readRun(row: Row): Row {
		return { ...row };
	}

	function readAction(row: Row): Row {
		const payload = row.payload as string | null;
		return { ...row, payload: payload === null ? null : (store.parseJSONColumn ? JSON.parse(payload) : payload) };
	}

	function bySeq(a: Row, b: Row): number {
		return (a.seq as number) - (b.seq as number);
	}

	/**
	 * Dispatches on the statement, the way `Tests/ChannelPurge.test.ts` does. Values are stored
	 * exactly as they arrive, which is also what the driver round-trips: BIGINT columns come back
	 * as `bigint`, INT columns as `number`.
	 */
	function query(sql: string, params: unknown[] = []): unknown {
		if (sql.includes('INSERT INTO SnapshotRestoreActions')) {
			const [restore_id, seq, category, change_type, target_id, label, payload, result] = params;
			store.actions.push({ restore_id, seq, category, change_type, target_id, label, payload, result, new_id: null, error: null });
			return { affectedRows: 1n };
		}

		if (sql.includes('INSERT INTO SnapshotRestores')) {
			const [guild_id, snapshot_id, import_id, safety_snapshot_id, user_id, channel_id, mask, status, total_actions, started_at] = params;
			const id = store.nextRunID++;
			store.runs.push({
				id, guild_id, snapshot_id, import_id, safety_snapshot_id, user_id, channel_id,
				message_id: null, mask, status, total_actions, applied_actions: 0, started_at, finished_at: null
			});
			return { insertId: BigInt(id) };
		}

		if (sql.includes('UPDATE SnapshotRestoreActions')) {
			// MarkRunningRestoresInterrupted - every PENDING action of every RUNNING run
			if (sql.includes('restore_id IN (SELECT')) {
				const [result, fromResult, runStatus] = params;
				const running = new Set(store.runs.filter(run => run.status === runStatus).map(run => run.id));
				for (const action of store.actions) {
					if (action.result === fromResult && running.has(action.restore_id)) action.result = result;
				}
				return { affectedRows: 0n };
			}

			// SkipRestoreActions - one chunk of seqs, new_id cleared by the statement itself
			if (sql.includes('new_id = NULL')) {
				const [result, error, restoreID, ...seqs] = params;
				for (const action of store.actions) {
					if (action.restore_id === restoreID && (seqs as number[]).includes(action.seq as number)) {
						Object.assign(action, { result, new_id: null, error });
					}
				}
				return { affectedRows: 0n };
			}

			// RecordActionResult - exactly one (restore_id, seq)
			const [result, newID, error, restoreID, seq] = params;
			for (const action of store.actions) {
				if (action.restore_id === restoreID && action.seq === seq) {
					Object.assign(action, { result, new_id: newID, error });
				}
			}
			return { affectedRows: 0n };
		}

		if (sql.includes('UPDATE SnapshotRestores')) {
			if (sql.includes('message_id')) {
				const [messageID, restoreID] = params;
				for (const run of store.runs) if (run.id === restoreID) run.message_id = messageID;
				return { affectedRows: 0n };
			}

			if (sql.includes('applied_actions')) { // FinishRestoreRun
				const [status, appliedActions, finishedAt, restoreID] = params;
				for (const run of store.runs) {
					if (run.id === restoreID) Object.assign(run, { status, applied_actions: appliedActions, finished_at: finishedAt });
				}
				return { affectedRows: 0n };
			}

			if (sql.includes('finished_at = NULL')) { // ReopenRestoreRun
				const [status, restoreID] = params;
				for (const run of store.runs) if (run.id === restoreID) Object.assign(run, { status, finished_at: null });
				return { affectedRows: 0n };
			}

			// MarkRunningRestoresInterrupted - every RUNNING run, no guild filter
			const [status, finishedAt, fromStatus] = params;
			for (const run of store.runs) {
				if (run.status === fromStatus) Object.assign(run, { status, finished_at: finishedAt });
			}
			return { affectedRows: 0n };
		}

		if (sql.includes('FROM SnapshotRestoreActions')) {
			const [restoreID, result] = params;
			return store.actions
				.filter(action => action.restore_id === restoreID && (result === undefined || action.result === result))
				.sort(bySeq)
				.map(readAction);
		}

		if (sql.includes('FROM SnapshotRestores')) {
			if (sql.includes('WHERE status = ?')) {
				const [status] = params;
				return store.runs.filter(run => run.status === status).map(readRun);
			}

			const [restoreID] = params;
			return store.runs.filter(run => run.id === restoreID).map(readRun);
		}

		throw new Error(`Unrecognised SQL in the fake database:\n${sql}`);
	}

	/**
	 * `beginTransaction` snapshots the store and `rollback` puts it back, so a rolled-back run
	 * really does leave nothing behind rather than merely being reported as rolled back.
	 */
	function makeConnection() {
		let snapshot: { runs: Row[], actions: Row[], nextRunID: number } | null = null;

		return {
			query: vi.fn(async (sql: string, params?: unknown[]) => query(sql, params)),
			batch: vi.fn(async (sql: string, rows: unknown[][]) => {
				for (const row of rows) query(sql, row);
			}),
			beginTransaction: vi.fn(async () => {
				snapshot = {
					runs     : store.runs.map(row => ({ ...row })),
					actions  : store.actions.map(row => ({ ...row })),
					nextRunID: store.nextRunID
				};
			}),
			commit: vi.fn(async () => {
				store.commits++;
				snapshot = null;
			}),
			rollback: vi.fn(async () => {
				store.rollbacks++;
				if (snapshot) {
					store.runs = snapshot.runs;
					store.actions = snapshot.actions;
					store.nextRunID = snapshot.nextRunID;
					snapshot = null;
				}
			}),
			release: vi.fn(async () => {})
		};
	}

	// Mirrors the real wrapper in src/Database.ts, same as Tests/ChannelPurge.test.ts's transaction
	const Database = {
		getConnection: vi.fn(async () => makeConnection()),
		releaseConnection: vi.fn(),
		query: vi.fn(async (sql: string, params?: unknown[]) => query(sql, params)),
		batch: vi.fn(async (sql: string, rows: unknown[][]) => {
			for (const row of rows) query(sql, row);
		}),
		transaction: vi.fn(async (callback: (connection: unknown) => unknown) => {
			const connection = await Database.getConnection();
			try {
				await connection.beginTransaction();
				const result = await callback(connection);
				await connection.commit();
				return result;
			} catch (error) {
				await connection.rollback();
				throw error;
			} finally {
				Database.releaseConnection(connection);
			}
		})
	};

	return { store, Database };
});
vi.mock('../../Database.js', () => ({ Database }));

const {
	CreateRestoreRun,
	FinishRestoreRun,
	GetRestoreActions,
	GetRestoreRun,
	HydratePayload,
	ListRunningRestores,
	MarkRunningRestoresInterrupted,
	ReopenRestoreRun,
	RecordActionResult,
	SetRestoreMessage,
	SkipRestoreActions
} = await import('../../CRUD/SnapshotRestores.js');

type NewRestoreAction = import('../../CRUD/SnapshotRestores.js').NewRestoreAction;
type NewRestoreRun = import('../../CRUD/SnapshotRestores.js').NewRestoreRun;

// RehydrateRemap is a pure function, but it lives in RestoreRunner.ts, which imports the real
// discord.js client from Client.js at module scope - mock it like every other consumer does,
// purely to satisfy that import.
vi.mock('../../Client.js');
const { RehydrateRemap } = await import('../../Services/RestoreRunner.js');

const GUILD_ID = 10n;

function baseRun(): NewRestoreRun {
	return {
		guild_id: GUILD_ID,
		snapshot_id: 1,
		import_id: null,
		safety_snapshot_id: null,
		user_id: 42n,
		channel_id: 43n,
		mask: RESTORE_OPTIONS.CHANNELS | RESTORE_OPTIONS.ROLES | RESTORE_OPTIONS.BANS
	};
}

/** `count` bare actions, so a run can be seeded at whatever size a case needs */
function actions(count: number): NewRestoreAction[] {
	return Array.from({ length: count }, (_, index) => ({
		category   : RESTORE_OPTIONS.ROLES,
		change_type: DIFF_CHANGE_TYPE.CREATE,
		target_id  : BigInt(index + 1),
		label      : `r${index}`,
		payload    : null
	}));
}

beforeEach(() => {
	store.reset();
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

		const restoreID = await CreateRestoreRun(baseRun(), [action]);
		const [row] = await GetRestoreActions(restoreID);

		expect(row.payload).toEqual(action.payload);
		expect(typeof (row.payload as { id: unknown }).id).toBe('bigint');
		expect(typeof (row.payload as { permissions: unknown }).permissions).toBe('bigint');
		expect(typeof (row.payload as { managed_by: unknown }).managed_by).toBe('bigint');
	});

	/**
	 * The round-trips above only mean something if the trip is real - a fake that handed the live
	 * object back would pass every one of them without `SerializePayload` ever running. Bigints do
	 * not survive `JSON.stringify` unaided (hence `JSONReplacer`), so this is also what proves they
	 * are written as strings rather than throwing.
	 */
	it('stores the payload as JSON text, not as a live object', async () => {
		const restoreID = await CreateRestoreRun(baseRun(), [{
			category: RESTORE_OPTIONS.ROLES,
			change_type: DIFF_CHANGE_TYPE.CREATE,
			target_id: 456n,
			label: '@Test Role',
			payload: { id: 456n, name: 'Test Role', color: 0, hoist: 0, position: 1, permissions: 8n, managed_by: null }
		}]);

		const stored = store.actions.find(action => action.restore_id === restoreID)!.payload;
		expect(typeof stored).toBe('string');
		expect(JSON.parse(stored as string)).toEqual({
			id: '456', name: 'Test Role', color: 0, hoist: 0, position: 1, permissions: '8', managed_by: null
		});
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

		const restoreID = await CreateRestoreRun(baseRun(), [action]);
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

		const restoreID = await CreateRestoreRun(baseRun(), [action]);
		const [row] = await GetRestoreActions(restoreID);
		const payload = row.payload as { id: bigint, reason: string };

		expect(payload.id).toBe(321n);
		expect(typeof payload.id).toBe('bigint');
		expect(payload.reason).toBe('raided the server');
	});

	/** The same round trip with the driver's JSON parsing turned off - `HydratePayload` absorbs it */
	it('round-trips unchanged when the driver hands back the raw column text', async () => {
		store.parseJSONColumn = false;

		const restoreID = await CreateRestoreRun(baseRun(), [{
			category: RESTORE_OPTIONS.ROLES,
			change_type: DIFF_CHANGE_TYPE.CREATE,
			target_id: 456n,
			label: '@Test Role',
			payload: { id: 456n, name: 'Test Role', color: 0, hoist: 0, position: 1, permissions: 8n, managed_by: 123n }
		}]);
		const [row] = await GetRestoreActions(restoreID);

		expect(row.payload).toEqual({ id: 456n, name: 'Test Role', color: 0, hoist: 0, position: 1, permissions: 8n, managed_by: 123n });
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

		const restoreID = await CreateRestoreRun(baseRun(), [action]);
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

		const restoreID = await CreateRestoreRun(baseRun(), [action]);
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

		const restoreID = await CreateRestoreRun(baseRun(), [action]);
		const [row] = await GetRestoreActions(restoreID);

		expect(row.payload).toBeNull();
		expect(store.actions[0].payload).toBeNull();
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

		await expect(CreateRestoreRun(baseRun(), [action])).rejects.toThrow();

		expect(store.rollbacks).toBe(1);
		expect(store.commits).toBe(0);
		expect(store.runs).toHaveLength(0);
		expect(store.actions).toHaveLength(0);
	});

	it('creates a run with zero actions - total_actions = 0, the action batch is skipped', async () => {
		const restoreID = await CreateRestoreRun(baseRun(), []);

		const run = await GetRestoreRun(restoreID);
		expect(run!.total_actions).toBe(0);

		expect(await GetRestoreActions(restoreID)).toHaveLength(0);
		expect(store.commits).toBe(1);
	});

	it('persists rows in exactly the plan order (seq = array index)', async () => {
		const plan: NewRestoreAction[] = Array.from({ length: 5 }, (_, i) => ({
			category: RESTORE_OPTIONS.BANS,
			change_type: DIFF_CHANGE_TYPE.CREATE,
			target_id: BigInt(100 + i),
			label: `ban-${i}`,
			payload: { id: BigInt(100 + i), reason: 'test' }
		}));

		const restoreID = await CreateRestoreRun(baseRun(), plan);
		const rows = await GetRestoreActions(restoreID);

		expect(rows.map(r => r.label)).toEqual(['ban-0', 'ban-1', 'ban-2', 'ban-3', 'ban-4']);
		expect(rows.map(r => r.seq)).toEqual([0, 1, 2, 3, 4]);
	});

	// The column is VARCHAR(200), so an over-long label would be the database's error to raise -
	// this truncates in code first, precisely so it never gets that far
	it('truncates a label at 200 characters without erroring', async () => {
		const longLabel = '#' + 'x'.repeat(300);
		const restoreID = await CreateRestoreRun(baseRun(), [{
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
		const snapshotRunID = await CreateRestoreRun({ ...baseRun(), snapshot_id: 5, import_id: null }, []);
		const importRunID = await CreateRestoreRun({ ...baseRun(), snapshot_id: null, import_id: 'ABCD-1234' }, []);

		const snapshotRun = await GetRestoreRun(snapshotRunID);
		expect(snapshotRun!.snapshot_id).toBe(5);
		expect(snapshotRun!.import_id).toBeNull();

		const importRun = await GetRestoreRun(importRunID);
		expect(importRun!.snapshot_id).toBeNull();
		expect(importRun!.import_id).toBe('ABCD-1234');
	});

	it('starts a run RUNNING, with no message id and nothing applied yet', async () => {
		const restoreID = await CreateRestoreRun(baseRun(), actions(2));
		const run = await GetRestoreRun(restoreID);

		expect(run!.status).toBe(RESTORE_STATUS.RUNNING);
		expect(run!.total_actions).toBe(2);
		expect(run!.applied_actions).toBe(0);
		expect(run!.message_id).toBeNull();
		expect(run!.finished_at).toBeNull();
		expect(typeof run!.started_at).toBe('bigint');
	});

	it('leaves every action PENDING, with no new_id and no error', async () => {
		const restoreID = await CreateRestoreRun(baseRun(), actions(2));
		const rows = await GetRestoreActions(restoreID);

		expect(rows.every(a => a.result === RESTORE_RESULT.PENDING)).toBe(true);
		expect(rows.every(a => a.new_id === null && a.error === null)).toBe(true);
	});
});

describe('SetRestoreMessage', () => {
	// The step log message is posted after the run row exists, so its ID lands in a second write
	it('writes the message id onto the run without touching anything else', async () => {
		const restoreID = await CreateRestoreRun(baseRun(), []);

		await SetRestoreMessage(restoreID, 40n);
		const run = await GetRestoreRun(restoreID);

		expect(run!.message_id).toBe(40n);
		expect(run!.status).toBe(RESTORE_STATUS.RUNNING);
	});
});

describe('RecordActionResult / GetRestoreActions filtering', () => {
	it('truncates a recorded error at 500 characters', async () => {
		const restoreID = await CreateRestoreRun(baseRun(), [{
			category: RESTORE_OPTIONS.ROLES, change_type: DIFF_CHANGE_TYPE.UPDATE, target_id: 1n, label: '@role', payload: null
		}]);
		const longError = 'E'.repeat(2000);

		await RecordActionResult(restoreID, 0, RESTORE_RESULT.FAILED, null, longError);
		const [row] = await GetRestoreActions(restoreID);

		expect(row.error).toBe(longError.slice(0, 500));
		expect(row.error).toHaveLength(500);
	});

	it('updates only the targeted (restore_id, seq) row, leaving siblings untouched', async () => {
		const restoreID = await CreateRestoreRun(baseRun(), [
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

	// `seq` is unique per run, not globally - a sibling run's row at the same seq must not move
	it('does not reach into another run at the same seq', async () => {
		const first = await CreateRestoreRun(baseRun(), actions(1));
		const second = await CreateRestoreRun(baseRun(), actions(1));

		await RecordActionResult(first, 0, RESTORE_RESULT.OK, 999n);

		expect((await GetRestoreActions(second))[0].result).toBe(RESTORE_RESULT.PENDING);
	});

	it('filters GetRestoreActions by result, staying seq-ordered', async () => {
		const restoreID = await CreateRestoreRun(baseRun(), [
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
	it('skips only the listed seqs and clears their new_id', async () => {
		const restoreID = await CreateRestoreRun(baseRun(), actions(4));

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
		const restoreID = await CreateRestoreRun(baseRun(), actions(1));
		const longError = 'E'.repeat(2000);

		await SkipRestoreActions(restoreID, [0], longError);
		const [row] = await GetRestoreActions(restoreID);

		expect(row.error).toHaveLength(500);
	});

	it('is a no-op for an empty seq list', async () => {
		const restoreID = await CreateRestoreRun(baseRun(), actions(2));
		Database.query.mockClear();

		await SkipRestoreActions(restoreID, [], 'stopped before this action ran');
		const rows = await GetRestoreActions(restoreID);

		expect(rows.every(a => a.result === RESTORE_RESULT.PENDING)).toBe(true);
		// Not merely harmless - an empty list must not reach the database at all, since
		// `seq IN ()` is a syntax error rather than a match-nothing
		expect(Database.query.mock.calls.filter(([sql]) => sql.includes('UPDATE'))).toHaveLength(0);
	});

	// The whole point of the helper is draining a large plan in as few round trips as possible, so the
	// case that spills past one `IN (...)` list has to update every row, not just the first chunk
	it('updates every row when the seq list spans more than one chunk', async () => {
		const total = 1201; // > 2 chunks of 500
		const restoreID = await CreateRestoreRun(baseRun(), actions(total));
		Database.query.mockClear();

		await SkipRestoreActions(restoreID, Array.from({ length: total }, (_, index) => index), 'stopped');
		const rows = await GetRestoreActions(restoreID);

		expect(rows).toHaveLength(total);
		expect(rows.every(a => a.result === RESTORE_RESULT.SKIPPED)).toBe(true);
		expect(Database.query.mock.calls.filter(([sql]) => sql.includes('UPDATE'))).toHaveLength(3);
	});
});

describe('RehydrateRemap', () => {
	it('rebuilds target_id -> new_id from persisted rows, for a retry re-parenting through a recreated category', async () => {
		const categoryID = 500n;
		const newCategoryID = 999n;

		const restoreID = await CreateRestoreRun(baseRun(), [
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

		const remap = RehydrateRemap(await GetRestoreActions(restoreID));

		expect(remap.get(categoryID)).toBe(newCategoryID);
		expect(remap.has(501n)).toBe(false);
	});
});

describe('Run lifecycle - FinishRestoreRun / ReopenRestoreRun', () => {
	it('FinishRestoreRun sets status, applied_actions and finished_at', async () => {
		const restoreID = await CreateRestoreRun(baseRun(), []);
		expect((await GetRestoreRun(restoreID))!.finished_at).toBeNull();

		await FinishRestoreRun(restoreID, RESTORE_STATUS.COMPLETE, 5);
		const run = await GetRestoreRun(restoreID);

		expect(run!.status).toBe(RESTORE_STATUS.COMPLETE);
		expect(run!.applied_actions).toBe(5);
		expect(run!.finished_at).not.toBeNull();
		expect(typeof run!.finished_at).toBe('bigint');
	});

	it('ReopenRestoreRun puts a finished run back to RUNNING and clears finished_at', async () => {
		const restoreID = await CreateRestoreRun(baseRun(), []);
		await FinishRestoreRun(restoreID, RESTORE_STATUS.FAILED, 0);

		await ReopenRestoreRun(restoreID);
		const run = await GetRestoreRun(restoreID);

		expect(run!.status).toBe(RESTORE_STATUS.RUNNING);
		expect(run!.finished_at).toBeNull();
	});
});

describe('ListRunningRestores', () => {
	it('returns only status = RUNNING runs, not the finished one', async () => {
		const runningID = await CreateRestoreRun(baseRun(), []);
		const finishedID = await CreateRestoreRun(baseRun(), []);
		await FinishRestoreRun(finishedID, RESTORE_STATUS.COMPLETE, 0);

		const running = await ListRunningRestores();

		expect(running.map(r => r.id)).toEqual([runningID]);
		expect(running.every(r => r.status === RESTORE_STATUS.RUNNING)).toBe(true);
	});
});

/**
 * Note this function has no guild filter - it interrupts every RUNNING run in the database, which
 * is correct at startup (nothing can be running yet) and would be destructive anywhere else.
 */
describe('MarkRunningRestoresInterrupted', () => {
	it('interrupts PENDING actions to SKIPPED and the run to INTERRUPTED, leaves finished runs alone', async () => {
		const runningID = await CreateRestoreRun(baseRun(), [
			{ category: RESTORE_OPTIONS.BANS, change_type: DIFF_CHANGE_TYPE.CREATE, target_id: 1n, label: 'a', payload: null },
			{ category: RESTORE_OPTIONS.BANS, change_type: DIFF_CHANGE_TYPE.CREATE, target_id: 2n, label: 'b', payload: null }
		]);
		await RecordActionResult(runningID, 0, RESTORE_RESULT.OK);
		// seq 1 is left PENDING on purpose

		const finishedID = await CreateRestoreRun(baseRun(), [
			{ category: RESTORE_OPTIONS.BANS, change_type: DIFF_CHANGE_TYPE.CREATE, target_id: 3n, label: 'c', payload: null }
		]);
		await RecordActionResult(finishedID, 0, RESTORE_RESULT.OK);
		await FinishRestoreRun(finishedID, RESTORE_STATUS.COMPLETE, 1);

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

	it('is a no-op when nothing is RUNNING', async () => {
		const finishedID = await CreateRestoreRun(baseRun(), actions(1));
		await FinishRestoreRun(finishedID, RESTORE_STATUS.COMPLETE, 1);

		await expect(MarkRunningRestoresInterrupted()).resolves.toBeUndefined();

		const run = await GetRestoreRun(finishedID);
		expect(run!.status).toBe(RESTORE_STATUS.COMPLETE);
		expect((await GetRestoreActions(finishedID))[0].result).toBe(RESTORE_RESULT.PENDING);
	});
});
