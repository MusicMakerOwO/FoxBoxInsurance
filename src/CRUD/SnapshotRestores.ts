import { Database } from "../Database.js";
import { RESTORE_OPTIONS, RESTORE_RESULT, RESTORE_STATUS } from "../Utils/Constants.js";
import { ObjectValues } from "../Typings/HelperTypes.js";
import {
	SnapshotChannel,
	SnapshotRestore,
	SnapshotRestoreAction,
	SnapshotRestorePayload,
	SnapshotRole,
	StoredRestorePayload
} from "../Typings/DatabaseTypes.js";
import { JSONReplacer, JSONStringify } from "../JSON.js";

type StoredChannel = JSONStringify<Omit<SnapshotChannel, 'snapshot_id' | 'deleted'>>;
type StoredRole    = JSONStringify<Omit<SnapshotRole   , 'snapshot_id' | 'deleted'>>;

/** The fields of a run that are known before it starts - everything else is defaulted or written later */
export type NewRestoreRun = Pick<SnapshotRestore,
	'guild_id' | 'snapshot_id' | 'import_id' | 'safety_snapshot_id' | 'user_id' | 'channel_id' | 'mask'>;

/**
 * The fields of an action that come from the plan. Structurally satisfied by a `RestoreAction`
 * from Services/RestorePlans.ts, which is deliberately not imported here - CRUD must not depend
 * on Services.
 */
export type NewRestoreAction = Pick<SnapshotRestoreAction,
	'category' | 'change_type' | 'target_id' | 'label' | 'payload'>;

const MAX_LABEL_LENGTH = 200; // matches SnapshotRestoreActions.label
const MAX_ERROR_LENGTH = 500;
/** How many `seq` values `SkipRestoreActions` puts in one `IN (...)` list */
const SKIP_CHUNK_SIZE = 500;

/**
 * Payloads carry bigints (`id`, `parent_id`, `permissions`, `managed_by`) which `JSON.stringify`
 * refuses on its own, so they go through `JSONReplacer` like every other bigint in this codebase.
 */
function SerializePayload(payload: SnapshotRestorePayload | null): string | null {
	if (!payload) return null;
	return JSON.stringify(payload, JSONReplacer);
}

/**
 * Reverses `SerializePayload`. The driver parses JSON columns for us, but tolerate a raw string in
 * case that is ever turned off. Which fields are bigints depends on the entity, hence `category`.
 *
 * @internal Exported for tests, not part of the module's API.
 */
export function HydratePayload(category: SnapshotRestoreAction['category'], stored: StoredRestorePayload | string | null): SnapshotRestorePayload | null {
	if (stored === null || stored === undefined) return null;

	const payload = (typeof stored === 'string' ? JSON.parse(stored) : stored) as StoredRestorePayload;

	if (category === RESTORE_OPTIONS.CHANNELS) {
		const channel = payload as StoredChannel;
		return {
			...channel,
			id       : BigInt(channel.id),
			parent_id: channel.parent_id === null ? null : BigInt(channel.parent_id)
		};
	}

	if (category === RESTORE_OPTIONS.ROLES) {
		const role = payload as StoredRole;
		return {
			...role,
			id         : BigInt(role.id),
			permissions: BigInt(role.permissions),
			managed_by : role.managed_by === null ? null : BigInt(role.managed_by)
		};
	}

	return { ...payload, id: BigInt(payload.id) } as SnapshotRestorePayload;
}

function HydrateAction(row: SnapshotRestoreAction & { payload: StoredRestorePayload | string | null }): SnapshotRestoreAction {
	return { ...row, payload: HydratePayload(row.category, row.payload) };
}

/**
 * Inserts the run and every one of its actions as `PENDING`, in one transaction - a run row
 * without its actions would be unrecoverable, since the plan only exists in memory.
 */
export async function CreateRestoreRun(run: NewRestoreRun, actions: NewRestoreAction[]): Promise<SnapshotRestore['id']> {
	return Database.transaction(async (connection) => {
		const insertResult = await connection.query(`
            INSERT INTO SnapshotRestores (
                                          guild_id, snapshot_id, import_id, safety_snapshot_id,
                                          user_id, channel_id,
                                          mask, status, total_actions, started_at
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`, [
			run.guild_id, run.snapshot_id, run.import_id, run.safety_snapshot_id,
			run.user_id, run.channel_id,
			run.mask, RESTORE_STATUS.RUNNING, actions.length, BigInt(Date.now())
		]) as { insertId: bigint };

		const restoreID = insertResult.insertId ? Number(insertResult.insertId) : null;
		if (!restoreID) throw new Error('Restore run not found after insertion - Is this within a transaction?');

		if (actions.length > 0) {
			await connection.batch(`
                INSERT INTO SnapshotRestoreActions (
                                                    restore_id, seq,
                                                    category, change_type, target_id, label,
                                                    payload, result
				) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
			`, actions.map((action, seq) => [
				restoreID, seq,
				action.category, action.change_type, action.target_id, action.label.slice(0, MAX_LABEL_LENGTH),
				SerializePayload(action.payload), RESTORE_RESULT.PENDING
			]));
		}

		return restoreID;
	});
}

/** The step log message is posted after the run row exists, so its ID lands separately */
export async function SetRestoreMessage(restoreID: SnapshotRestore['id'], messageID: bigint): Promise<void> {
	await Database.query(`
        UPDATE SnapshotRestores
        SET message_id = ?
        WHERE id = ?
	`, [messageID, restoreID]);
}

export async function GetRestoreRun(restoreID: SnapshotRestore['id']): Promise<SnapshotRestore | null> {
	return await Database.query(`
        SELECT *
        FROM SnapshotRestores
        WHERE id = ?
	`, [restoreID]).then(rows => rows[0] ?? null) as SnapshotRestore | null;
}

/** Ordered by `seq`, which is the apply order. Pass `result` to fetch only the failures (retry) */
export async function GetRestoreActions(restoreID: SnapshotRestore['id'], result?: ObjectValues<typeof RESTORE_RESULT>): Promise<SnapshotRestoreAction[]> {
	const rows = await (result === undefined
		? Database.query(`
            SELECT *
            FROM SnapshotRestoreActions
            WHERE restore_id = ?
            ORDER BY seq ASC
		`, [restoreID])
		: Database.query(`
            SELECT *
            FROM SnapshotRestoreActions
            WHERE restore_id = ? AND result = ?
            ORDER BY seq ASC
		`, [restoreID, result])
	) as (SnapshotRestoreAction & { payload: StoredRestorePayload | string | null })[];

	return rows.map(HydrateAction);
}

export async function RecordActionResult(
	restoreID: SnapshotRestore['id'],
	seq: SnapshotRestoreAction['seq'],
	result: ObjectValues<typeof RESTORE_RESULT>,
	newID: bigint | null = null,
	error: string | null = null
): Promise<void> {
	await Database.query(`
        UPDATE SnapshotRestoreActions
        SET result = ?, new_id = ?, error = ?
        WHERE restore_id = ? AND seq = ?
	`, [result, newID, error?.slice(0, MAX_ERROR_LENGTH) ?? null, restoreID, seq]);
}

/**
 * Marks many actions SKIPPED at once, with the same column effects as `RecordActionResult`.
 *
 * A stopped run drains the rest of its slice through here rather than one `RecordActionResult` per
 * action: a large plan is hundreds of sequential round trips, which is most of why a stop could miss
 * the shutdown grace. The `seq` values are passed explicitly instead of as a `seq >= ?` range,
 * because a retry's slice is the non-contiguous set of actions that failed last time.
 */
export async function SkipRestoreActions(
	restoreID: SnapshotRestore['id'],
	seqs: SnapshotRestoreAction['seq'][],
	error: string
): Promise<void> {
	const truncated = error.slice(0, MAX_ERROR_LENGTH);

	for (let index = 0; index < seqs.length; index += SKIP_CHUNK_SIZE) {
		const chunk = seqs.slice(index, index + SKIP_CHUNK_SIZE);

		await Database.query(`
            UPDATE SnapshotRestoreActions
            SET result = ?, new_id = NULL, error = ?
            WHERE restore_id = ? AND seq IN (${chunk.map(() => '?').join(', ')})
		`, [RESTORE_RESULT.SKIPPED, truncated, restoreID, ...chunk]);
	}
}

export async function FinishRestoreRun(restoreID: SnapshotRestore['id'], status: ObjectValues<typeof RESTORE_STATUS>, appliedActions: number): Promise<void> {
	await Database.query(`
        UPDATE SnapshotRestores
        SET status = ?, applied_actions = ?, finished_at = ?
        WHERE id = ?
	`, [status, appliedActions, BigInt(Date.now()), restoreID]);
}

/**
 * Puts a finished run back into RUNNING for a retry.
 *
 * Without this the row stays FAILED for the whole retry, so a crash mid-retry is invisible to
 * `ListRunningRestores` and the run is never reconciled at the next startup. `FinishRestoreRun`
 * closes it again, and `finished_at` is cleared so the log does not claim it ended before it did.
 */
export async function ReopenRestoreRun(restoreID: SnapshotRestore['id']): Promise<void> {
	await Database.query(`
        UPDATE SnapshotRestores
        SET status = ?, finished_at = NULL
        WHERE id = ?
	`, [RESTORE_STATUS.RUNNING, restoreID]);
}

/** Only meaningful at startup - while the bot is up, the in-memory lock is the source of truth */
export async function ListRunningRestores(): Promise<SnapshotRestore[]> {
	return await Database.query(`
        SELECT *
        FROM SnapshotRestores
        WHERE status = ?
	`, [RESTORE_STATUS.RUNNING]) as SnapshotRestore[];
}

/**
 * A run marked RUNNING at startup was killed mid-restore. There is no resume: replaying a
 * half-applied plan against a server that has since changed is a worse failure mode than saying
 * so. Actions still PENDING are marked SKIPPED so the log reads honestly.
 */
export async function MarkRunningRestoresInterrupted(): Promise<void> {
	await Database.query(`
        UPDATE SnapshotRestoreActions
        SET result = ?
        WHERE result = ?
          AND restore_id IN (SELECT id FROM SnapshotRestores WHERE status = ?)
	`, [RESTORE_RESULT.SKIPPED, RESTORE_RESULT.PENDING, RESTORE_STATUS.RUNNING]);

	await Database.query(`
        UPDATE SnapshotRestores
        SET status = ?, finished_at = ?
        WHERE status = ?
	`, [RESTORE_STATUS.INTERRUPTED, BigInt(Date.now()), RESTORE_STATUS.RUNNING]);
}
