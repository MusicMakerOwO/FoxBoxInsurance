import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { APIEmbed } from 'discord-api-types/v10';
import {
	DIFF_CHANGE_TYPE,
	EMOJI,
	RESTORE_OPTIONS,
	RESTORE_RESULT,
	RESTORE_STATUS
} from '../../Utils/Constants.js';
import { SnapshotRestore, SnapshotRestoreAction } from '../../Typings/DatabaseTypes.js';
import {
	ApplyGuild,
	ApplyGuildOptions,
	RESTORE_NOW as NOW,
	ResetActionSeq,
	makeApplyGuild,
	restoreAction as action,
	restoreRecord as record
} from './Fixtures.js';

/**
 * §11 of the test plan: the orchestration around the apply loop - the guild lock, stop requests,
 * retry, shutdown and startup reconciliation. §9 and §10 own the loop itself.
 *
 * Everything here reads or writes module-level state (`restoringGuilds`, `activeRuns`,
 * `pendingStops`, `shuttingDown`), and `shuttingDown` is never cleared once set, so each test gets a
 * fresh copy of the module through `vi.resetModules()` + a dynamic import rather than the single
 * top-level import `RestoreRunner.test.ts` uses.
 */

const GUILD = '10';       // `restoreRecord`'s guild_id
const OTHER_GUILD = '11';
const CHANNEL = '30';     // `restoreRecord`'s channel_id

/** A promise a test resolves by hand, used to park a run mid-action or a log edit mid-flight */
type Gate = { promise: Promise<void>, resolve: () => void };

function deferred(): Gate {
	let resolve!: () => void;
	const promise = new Promise<void>(r => { resolve = () => r() });
	return { promise, resolve };
}

/** Drains the microtask queue so a run started with `void` reaches its next real await */
async function settle(ticks = 20): Promise<void> {
	for (let i = 0; i < ticks; i++) await Promise.resolve();
}

const { client } = vi.hoisted(() => ({
	client: {
		user    : { id: '999' },
		guilds  : { cache: new Map<string, unknown>() },
		channels: { cache: new Map<string, unknown>() },
		users   : { fetch: vi.fn() }
	}
}));
vi.mock('../../Client.js', () => ({ client }));

// Every persisted write is a spy: this section is about what the runner *decides*, and a stray query
// would hang against a MariaDB that may not be running
const crud = vi.hoisted(() => ({
	FinishRestoreRun             : vi.fn(),
	GetRestoreActions            : vi.fn(),
	GetRestoreRun                : vi.fn(),
	ListRunningRestores          : vi.fn(),
	MarkRunningRestoresInterrupted: vi.fn(),
	RecordActionResult           : vi.fn(),
	SkipRestoreActions           : vi.fn()
}));
vi.mock('../../CRUD/SnapshotRestores.js', () => crud);

const guilds = vi.hoisted(() => ({ GetGuild: vi.fn(), SaveGuild: vi.fn() }));
vi.mock('../../CRUD/Guilds.js', () => guilds);

/**
 * Nothing in the retry path is supposed to reach for the snapshot a run came from - it replays the
 * payloads persisted on `SnapshotRestoreActions`. `Services/RestoreRunner.ts` does not import this
 * module today; these are spies so that it stays that way, since a plan rebuilt against the server as
 * it is *now* could surface actions nobody approved (see `RetryRestore`'s doc comment).
 */
const snapshots = vi.hoisted(() => ({
	ListSnapshotsForGuild: vi.fn(),
	GetSnapshot          : vi.fn(),
	CreateSnapshot       : vi.fn(),
	DeleteSnapshot       : vi.fn(),
	ExportSnapshot       : vi.fn(),
	IsSnapshotQueuedForDeletion: vi.fn(),
	IsSnapshotDeletable  : vi.fn(),
	MaxSnapshotsForGuild : vi.fn(),
	SetSnapshotPinStatus : vi.fn()
}));
vi.mock('../../CRUD/Snapshots.js', () => snapshots);

// `ExecuteRun`'s finally invalidates every cached plan for the guild - the real module would drag the
// whole plan builder in behind it
const plans = vi.hoisted(() => ({ InvalidateRestorePlans: vi.fn() }));
vi.mock('../../Services/RestorePlans.js', () => plans);

const { LogSpy } = vi.hoisted(() => ({ LogSpy: vi.fn() }));
vi.mock('../../Utils/Log.js', async (importOriginal) => ({
	...(await importOriginal<typeof import('../../Utils/Log.js')>()),
	Log: LogSpy
}));

type Runner = typeof import('../../Services/RestoreRunner.js');
type EditPayload = { embeds: APIEmbed[] };

let runner: Runner;
/** Every payload handed to `messages.edit`, in order, across both the ticker and the final render */
let edits: EditPayload[];
let editIDs: string[];
/** Set to hold the *next* log edit only - used to keep a ticker edit in flight past `clearInterval` */
let editGate: Gate | null;

beforeEach(async () => {
	vi.resetModules();
	vi.clearAllMocks();
	vi.useFakeTimers();
	vi.setSystemTime(NOW);
	ResetActionSeq();

	edits = [];
	editIDs = [];
	editGate = null;

	client.guilds.cache.clear();
	client.channels.cache.clear();
	client.users.fetch.mockResolvedValue({ tag: 'admin#0001' });
	client.channels.cache.set(CHANNEL, {
		isSendable: () => true,
		messages  : {
			edit: vi.fn(async (id: string, payload: EditPayload) => {
				editIDs.push(id);
				edits.push(payload);

				const gate = editGate;
				editGate = null;
				if (gate) await gate.promise;
			})
		}
	});

	crud.FinishRestoreRun.mockResolvedValue(undefined);
	crud.RecordActionResult.mockResolvedValue(undefined);
	crud.SkipRestoreActions.mockResolvedValue(undefined);
	crud.GetRestoreRun.mockResolvedValue(null);
	crud.GetRestoreActions.mockResolvedValue([]);
	crud.ListRunningRestores.mockResolvedValue([]);
	crud.MarkRunningRestoresInterrupted.mockResolvedValue(undefined);
	guilds.GetGuild.mockResolvedValue(null);
	guilds.SaveGuild.mockResolvedValue(undefined);

	runner = await import('../../Services/RestoreRunner.js');
});

afterEach(() => {
	vi.useRealTimers();
});

//////////////////
// Fixtures
//////////////////

function seedGuild(options: ApplyGuildOptions = {}): ApplyGuild {
	const applyGuild = makeApplyGuild({ id: GUILD, ...options });
	client.guilds.cache.set(GUILD, applyGuild.guild);
	return applyGuild;
}

function seedRun(actions: SnapshotRestoreAction[], overrides: Partial<SnapshotRestore> = {}): void {
	crud.GetRestoreRun.mockResolvedValue(record(overrides));
	crud.GetRestoreActions.mockResolvedValue(actions);
}

function roleCreate(target: bigint, name: string, overrides: Partial<SnapshotRestoreAction> = {}): SnapshotRestoreAction {
	return action({
		category   : RESTORE_OPTIONS.ROLES,
		change_type: DIFF_CHANGE_TYPE.CREATE,
		target_id  : target,
		label      : `@${name}`,
		payload    : { id: target, name, color: 0, position: 1, hoist: 0, permissions: 0n, managed_by: null },
		...overrides
	} as Partial<SnapshotRestoreAction>);
}

function channelCreate(target: bigint, name: string, parent: bigint | null, overrides: Partial<SnapshotRestoreAction> = {}): SnapshotRestoreAction {
	return action({
		category   : RESTORE_OPTIONS.CHANNELS,
		change_type: DIFF_CHANGE_TYPE.CREATE,
		target_id  : target,
		label      : `#${name}`,
		payload    : {
			id: target, type: 0, name, position: 0,
			topic: null, nsfw: 0, parent_id: parent, permission_overwrites: {}
		},
		...overrides
	} as Partial<SnapshotRestoreAction>);
}

/**
 * Suspends the first `roles.create` of a run, so a test can observe the run mid-flight - registered in
 * `activeRuns`, lock held, actions still pending. Calls still land on `spies.rolesCreate`.
 */
function gateFirstRoleCreate(applyGuild: ApplyGuild): Gate {
	const gate = deferred();
	const create = applyGuild.spies.rolesCreate as unknown as (options: unknown) => Promise<unknown>;
	let first = true;

	(applyGuild.guild.roles as unknown as { create: unknown }).create = vi.fn(async (options: unknown) => {
		if (first) {
			first = false;
			await gate.promise;
		}
		return create(options);
	});

	return gate;
}

function titleOf(payload: EditPayload): string {
	return payload.embeds[0].title ?? '';
}

//////////////////
// The guild lock
//////////////////

describe('ClaimRestoreLock', () => {
	it('is atomic - a second synchronous claim is refused', () => {
		expect(runner.ClaimRestoreLock(GUILD)).toBe(true);
		expect(runner.ClaimRestoreLock(GUILD)).toBe(false);
		expect(runner.IsRestoreRunning(GUILD)).toBe(true);
	});

	it('does not lock other guilds', () => {
		runner.ClaimRestoreLock(GUILD);

		expect(runner.ClaimRestoreLock(OTHER_GUILD)).toBe(true);
		expect(runner.IsRestoreRunning(OTHER_GUILD)).toBe(true);
	});

	it('can be reclaimed once released', () => {
		runner.ClaimRestoreLock(GUILD);
		runner.ReleaseRestoreLock(GUILD);

		expect(runner.IsRestoreRunning(GUILD)).toBe(false);
		expect(runner.ClaimRestoreLock(GUILD)).toBe(true);
	});
});

describe('StartRun', () => {
	it('releases the lock even when the run row is gone', async () => {
		runner.ClaimRestoreLock(GUILD);
		crud.GetRestoreRun.mockResolvedValue(null);

		await expect(runner.RunRestore(1, GUILD)).rejects.toThrow('has no run row or guild');
		expect(runner.IsRestoreRunning(GUILD)).toBe(false);
	});

	it('releases the lock even when the guild is not cached', async () => {
		runner.ClaimRestoreLock(GUILD);
		seedRun([]);
		// no `client.guilds.cache` entry

		await expect(runner.RunRestore(1, GUILD)).rejects.toThrow('has no run row or guild');
		expect(runner.IsRestoreRunning(GUILD)).toBe(false);
	});

	it('releases the lock when the run completes', async () => {
		seedGuild();
		seedRun([roleCreate(1n, 'Mod')]);
		runner.ClaimRestoreLock(GUILD);

		await runner.RunRestore(1, GUILD);

		expect(runner.IsRestoreRunning(GUILD)).toBe(false);
	});
});

//////////////////
// RequestStop
//////////////////

describe('RequestStop', () => {
	it('refuses a run whose guild holds no lock', () => {
		expect(runner.RequestStop(1, GUILD)).toBe(false);
	});

	it('refuses a live run asked to stop from another guild', async () => {
		const applyGuild = seedGuild();
		const gate = gateFirstRoleCreate(applyGuild);
		seedRun([roleCreate(1n, 'Mod'), roleCreate(2n, 'Admin')]);
		runner.ClaimRestoreLock(GUILD);

		const running = runner.RunRestore(1, GUILD);
		await settle();

		expect(runner.RequestStop(1, OTHER_GUILD)).toBe(false);
		expect(runner.RequestStop(1, GUILD)).toBe(true);

		gate.resolve();
		await running;
	});

	it('refuses a run that has already finished but is still registered', async () => {
		seedGuild();
		seedRun([roleCreate(1n, 'Mod')]);
		runner.ClaimRestoreLock(GUILD);

		// The only log edit of this run is the final one, so gating it parks the run inside its own
		// `finally` - registered in `activeRuns`, `finished` already true
		const gate = deferred();
		editGate = gate;

		const running = runner.RunRestore(1, GUILD);
		await settle();

		expect(runner.RequestStop(1, GUILD)).toBe(false);

		gate.resolve();
		await running;
	});

	it('refuses a finished run once it has been deregistered', async () => {
		seedGuild();
		seedRun([roleCreate(1n, 'Mod')]);
		runner.ClaimRestoreLock(GUILD);
		await runner.RunRestore(1, GUILD);

		expect(runner.RequestStop(1, GUILD)).toBe(false);
	});

	it('stops a run that is still loading, before it applies anything (Bug #15)', async () => {
		const applyGuild = seedGuild();
		seedRun([roleCreate(1n, 'Mod'), roleCreate(2n, 'Admin')]);

		// The window the handler opens: the lock is claimed, but `StartRun` has not built a run object
		runner.ClaimRestoreLock(GUILD);
		expect(runner.RequestStop(1, GUILD)).toBe(true);

		await runner.RunRestore(1, GUILD);

		expect(applyGuild.spies.rolesCreate).not.toHaveBeenCalled();
		expect(crud.RecordActionResult).not.toHaveBeenCalled();
		expect(crud.SkipRestoreActions).toHaveBeenCalledTimes(1);
		expect(crud.SkipRestoreActions).toHaveBeenCalledWith(1, [0, 1], 'stopped before this action ran');
		expect(crud.FinishRestoreRun).toHaveBeenCalledWith(1, RESTORE_STATUS.STOPPED, 0);
	});

	it('does not let a stop for one run reach a different run starting in the same guild', async () => {
		const applyGuild = seedGuild();
		seedRun([roleCreate(1n, 'Mod')]);

		runner.ClaimRestoreLock(GUILD);
		runner.RequestStop(7, GUILD); // a different run's log

		await runner.RunRestore(1, GUILD);

		expect(applyGuild.spies.rolesCreate).toHaveBeenCalledTimes(1);
		expect(crud.FinishRestoreRun).toHaveBeenCalledWith(1, RESTORE_STATUS.COMPLETE, 1);
	});
});

/**
 * Bug #18. `RequestStop` authorises on the guild lock but keys on the run, so a stale click on an
 * older run's log is accepted while any restore is in flight. Entries used to be cleared only by the
 * `StartRun` that consumed them, which left an ID that never starts sitting there for the life of the
 * process - and stopping that run's *next* attempt.
 */
describe('RequestStop - stale intents (Bug #18)', () => {
	it('drops a pending stop when the lock that authorised it is released', async () => {
		const applyGuild = seedGuild();
		seedRun([roleCreate(1n, 'Mod', { result: RESTORE_RESULT.FAILED, error: 'Missing Permissions' })], { id: 5 });

		// Run #9 is in flight, so a click on failed run #5's still-rendered log is accepted
		runner.ClaimRestoreLock(GUILD);
		expect(runner.RequestStop(5, GUILD)).toBe(true);
		runner.ReleaseRestoreLock(GUILD);

		// ...and hours later, the admin retries #5
		runner.ClaimRestoreLock(GUILD);
		await runner.RetryRestore(5, GUILD);

		expect(applyGuild.spies.rolesCreate).toHaveBeenCalledTimes(1);
		expect(crud.FinishRestoreRun).toHaveBeenCalledWith(5, RESTORE_STATUS.COMPLETE, 1);
	});

	it('drops a pending stop recorded while another run held the lock', async () => {
		const applyGuild = seedGuild();
		const gate = gateFirstRoleCreate(applyGuild);
		seedRun([roleCreate(1n, 'Mod')], { id: 9 });

		runner.ClaimRestoreLock(GUILD);
		const running = runner.RunRestore(9, GUILD);
		await settle();

		runner.RequestStop(5, GUILD);

		gate.resolve();
		await running;

		// Run #9 finished and released the lock, taking #5's intent with it
		seedRun([roleCreate(1n, 'Mod')], { id: 5 });
		runner.ClaimRestoreLock(GUILD);
		await runner.RunRestore(5, GUILD);

		expect(crud.FinishRestoreRun).toHaveBeenLastCalledWith(5, RESTORE_STATUS.COMPLETE, 1);
	});

	it('still stops the run the intent was recorded for', async () => {
		seedGuild();
		seedRun([roleCreate(1n, 'Mod')], { id: 5 });

		runner.ClaimRestoreLock(GUILD);
		runner.RequestStop(5, GUILD);
		await runner.RunRestore(5, GUILD);

		expect(crud.FinishRestoreRun).toHaveBeenCalledWith(5, RESTORE_STATUS.STOPPED, 0);
	});
});

//////////////////
// Stopping a live run
//////////////////

describe('a stopped run', () => {
	it('finishes the action in flight and skips the rest', async () => {
		const applyGuild = seedGuild();
		const gate = gateFirstRoleCreate(applyGuild);
		seedRun([roleCreate(1n, 'Mod'), roleCreate(2n, 'Admin'), roleCreate(3n, 'Helper')]);
		runner.ClaimRestoreLock(GUILD);

		const running = runner.RunRestore(1, GUILD);
		await settle();

		expect(runner.RequestStop(1, GUILD)).toBe(true);
		gate.resolve();
		await running;

		expect(applyGuild.spies.rolesCreate).toHaveBeenCalledTimes(1);

		// The one action that actually ran is recorded on its own; the two it never reached go down
		// together, so the drain is a single round trip however long the plan is
		expect(crud.RecordActionResult).toHaveBeenCalledTimes(1);
		expect(crud.RecordActionResult).toHaveBeenCalledWith(1, 0, RESTORE_RESULT.OK, expect.any(BigInt), null);
		expect(crud.SkipRestoreActions).toHaveBeenCalledTimes(1);
		expect(crud.SkipRestoreActions).toHaveBeenCalledWith(1, [1, 2], 'stopped before this action ran');

		expect(crud.FinishRestoreRun).toHaveBeenCalledWith(1, RESTORE_STATUS.STOPPED, 1);
		expect(titleOf(edits[edits.length - 1])).toBe(`${EMOJI.STOP} Restore stopped`);
	});

	it('still reports the skipped actions when the drain write fails', async () => {
		const applyGuild = seedGuild();
		const gate = gateFirstRoleCreate(applyGuild);
		seedRun([roleCreate(1n, 'Mod'), roleCreate(2n, 'Admin'), roleCreate(3n, 'Helper')]);
		runner.ClaimRestoreLock(GUILD);

		// The pool is usually on its way out when a run is stopping - the in-memory counters are what
		// the completion embed renders from, so they must not depend on the write landing
		crud.SkipRestoreActions.mockRejectedValue(new Error('pool destroyed'));

		const running = runner.RunRestore(1, GUILD);
		await settle();

		runner.RequestStop(1, GUILD);
		gate.resolve();
		await running;

		expect(crud.FinishRestoreRun).toHaveBeenCalledWith(1, RESTORE_STATUS.STOPPED, 1);
		expect(titleOf(edits[edits.length - 1])).toBe(`${EMOJI.STOP} Restore stopped`);
		expect(LogSpy).toHaveBeenCalledWith('ERROR', expect.objectContaining({ message: 'pool destroyed' }));
	});
});

//////////////////
// Retry
//////////////////

describe('RetryRestore', () => {
	it('re-applies only the FAILED rows', async () => {
		const applyGuild = seedGuild();
		const ok      = roleCreate(1n, 'Mod'    , { result: RESTORE_RESULT.OK, new_id: 111n });
		const failed  = roleCreate(2n, 'Admin'  , { result: RESTORE_RESULT.FAILED, error: 'Missing Permissions' });
		const skipped = roleCreate(3n, 'Helper' , { result: RESTORE_RESULT.SKIPPED });
		seedRun([ok, failed, skipped]);
		runner.ClaimRestoreLock(GUILD);

		await runner.RetryRestore(1, GUILD);

		expect(applyGuild.spies.rolesCreate).toHaveBeenCalledTimes(1);
		expect(crud.RecordActionResult).toHaveBeenCalledTimes(1);
		expect(crud.RecordActionResult).toHaveBeenCalledWith(1, failed.seq, RESTORE_RESULT.OK, expect.any(BigInt), null);
	});

	it('drains only its own slice when stopped, not the rows in between', async () => {
		const applyGuild = seedGuild();
		const gate = gateFirstRoleCreate(applyGuild);

		// A retry's slice is not a contiguous range, which is why the drain names the seqs it means
		// rather than everything from here on
		const first  = roleCreate(1n, 'Mod'   , { result: RESTORE_RESULT.FAILED, error: 'Missing Permissions' });
		const ok     = roleCreate(2n, 'Admin' , { result: RESTORE_RESULT.OK, new_id: 111n });
		const second = roleCreate(3n, 'Helper', { result: RESTORE_RESULT.FAILED, error: 'Missing Permissions' });
		const done   = roleCreate(4n, 'Muted' , { result: RESTORE_RESULT.OK, new_id: 222n });
		const third  = roleCreate(5n, 'Trial' , { result: RESTORE_RESULT.FAILED, error: 'Missing Permissions' });
		seedRun([first, ok, second, done, third]);
		runner.ClaimRestoreLock(GUILD);

		const running = runner.RetryRestore(1, GUILD);
		await settle();

		expect(runner.RequestStop(1, GUILD)).toBe(true);
		gate.resolve();
		await running;

		expect(crud.SkipRestoreActions).toHaveBeenCalledTimes(1);
		expect(crud.SkipRestoreActions).toHaveBeenCalledWith(1, [second.seq, third.seq], 'stopped before this action ran');
		expect(ok.result).toBe(RESTORE_RESULT.OK);
		expect(done.result).toBe(RESTORE_RESULT.OK);
	});

	it('counts the retried failure as a transition, not a fresh success', async () => {
		seedGuild();
		const ok     = roleCreate(1n, 'Mod'  , { result: RESTORE_RESULT.OK, new_id: 111n });
		const failed = roleCreate(2n, 'Admin', { result: RESTORE_RESULT.FAILED, error: 'Missing Permissions' });
		seedRun([ok, failed]);
		runner.ClaimRestoreLock(GUILD);

		await runner.RetryRestore(1, GUILD);

		// 2 applied, no failures left - not 1 applied and 1 still failed
		expect(crud.FinishRestoreRun).toHaveBeenCalledWith(1, RESTORE_STATUS.COMPLETE, 2);
	});

	it('says how many actions it is replaying', async () => {
		seedGuild();
		seedRun([roleCreate(1n, 'Mod', { result: RESTORE_RESULT.FAILED, error: 'Missing Permissions' })]);
		runner.ClaimRestoreLock(GUILD);

		await runner.RetryRestore(1, GUILD);

		expect(edits[edits.length - 1].embeds[0].description).toContain('Retrying 1 failed action');
	});
});

/**
 * §14: a retry replays the payloads persisted on `SnapshotRestoreActions`, so it is unaffected by the
 * source snapshot being deleted in between - there is no foreign key from `SnapshotRestores.snapshot_id`
 * to `Snapshots(id)` (pinned in `DBSchemaGuards.test.ts`) and nothing on this path reads
 * the snapshot tables. That is deliberate: rebuilding the plan would diff against the server as it is
 * *now* and could surface actions the admin never confirmed.
 */
describe('RetryRestore - replays persisted payloads, not the snapshot', () => {
	it('never reads the snapshot the run came from', async () => {
		seedGuild();
		seedRun([roleCreate(1n, 'Mod', { result: RESTORE_RESULT.FAILED, error: 'Missing Permissions' })]);
		runner.ClaimRestoreLock(GUILD);

		await runner.RetryRestore(1, GUILD);

		// The source snapshot may well have been deleted since the original run - nothing here may
		// depend on it still existing
		expect(snapshots.GetSnapshot).not.toHaveBeenCalled();
		expect(snapshots.ListSnapshotsForGuild).not.toHaveBeenCalled();
	});

	it('sends Discord the persisted payload verbatim', async () => {
		const applyGuild = seedGuild();
		seedRun([roleCreate(1n, 'Admin', {
			result     : RESTORE_RESULT.FAILED,
			error      : 'Missing Permissions',
			// Distinctive values, so a payload rebuilt from anywhere else would not match
			payload    : { id: 1n, name: 'Admin', color: 0xFF00FF, position: 7, hoist: 1, permissions: 8n, managed_by: null }
		} as Partial<SnapshotRestoreAction>)]);
		runner.ClaimRestoreLock(GUILD);

		await runner.RetryRestore(1, GUILD);

		expect(applyGuild.spies.rolesCreate).toHaveBeenCalledWith(expect.objectContaining({
			name       : 'Admin',
			color      : 0xFF00FF,
			hoist      : true,
			permissions: 8n
		}));
	});

	/**
	 * The one place a retry would otherwise need the snapshot: the category this channel belongs under
	 * was recreated by the original run and carries a snowflake that exists nowhere in the snapshot.
	 * `RehydrateRemap` recovers it from the persisted `new_id` column instead.
	 */
	it('re-parents through the new_id of a category the original run created', async () => {
		const newCategoryID = 900_500n;
		// The category exists on the live guild under its *new* ID, which is all the parent check sees
		const applyGuild = seedGuild({ channels: [newCategoryID] });

		const category = channelCreate(500n, 'staff', null, { result: RESTORE_RESULT.OK, new_id: newCategoryID });
		const child    = channelCreate(501n, 'logs', 500n, { result: RESTORE_RESULT.FAILED, error: 'Missing Permissions' });
		seedRun([category, child]);
		runner.ClaimRestoreLock(GUILD);

		await runner.RetryRestore(1, GUILD);

		// The old category ID (500) would be rejected by Discord, and skipping as "parent category was
		// not created" would strand the channel for good - the row would be SKIPPED, not FAILED
		expect(applyGuild.spies.channelsCreate).toHaveBeenCalledTimes(1);
		expect(applyGuild.spies.channelsCreate).toHaveBeenCalledWith(expect.objectContaining({
			name  : 'logs',
			parent: String(newCategoryID)
		}));
		expect(child.result).toBe(RESTORE_RESULT.OK);
		expect(snapshots.GetSnapshot).not.toHaveBeenCalled();
	});
});

//////////////////
// Finishing
//////////////////

describe('finishing a run', () => {
	it('invalidates every cached plan for the guild', async () => {
		seedGuild();
		seedRun([roleCreate(1n, 'Mod')]);
		runner.ClaimRestoreLock(GUILD);

		await runner.RunRestore(1, GUILD);

		expect(plans.InvalidateRestorePlans).toHaveBeenCalledWith(GUILD);
	});

	it('stamps last_restore when something applied', async () => {
		seedGuild();
		seedRun([roleCreate(1n, 'Mod')]);
		guilds.GetGuild.mockResolvedValue({ id: BigInt(GUILD), name: 'Test', features: 0, last_restore: 0n });
		runner.ClaimRestoreLock(GUILD);

		await runner.RunRestore(1, GUILD);

		expect(guilds.SaveGuild).toHaveBeenCalledWith(expect.objectContaining({ last_restore: BigInt(NOW) }));
	});

	it('does not stamp last_restore when nothing applied', async () => {
		seedGuild();
		seedRun([roleCreate(1n, 'Mod')]);
		guilds.GetGuild.mockResolvedValue({ id: BigInt(GUILD), name: 'Test', features: 0, last_restore: 0n });
		runner.ClaimRestoreLock(GUILD);
		runner.RequestStop(1, GUILD);

		await runner.RunRestore(1, GUILD);

		expect(guilds.GetGuild).not.toHaveBeenCalled();
		expect(guilds.SaveGuild).not.toHaveBeenCalled();
	});

	/**
	 * Bug #8. The 2s ticker and the completion render both edit the same message; a tick already in
	 * the air when the loop ends used to land last and leave the log stuck on "Restoring..." with a
	 * live Stop button.
	 */
	it('does not let an in-flight ticker edit land after the completion embed', async () => {
		const applyGuild = seedGuild();
		const gate = gateFirstRoleCreate(applyGuild);
		seedRun([roleCreate(1n, 'Mod')]);
		runner.ClaimRestoreLock(GUILD);

		const running = runner.RunRestore(1, GUILD);
		await settle();

		// A ticker edit fires and is left hanging, exactly as a slow API call would be
		const logGate = deferred();
		editGate = logGate;
		await vi.advanceTimersByTimeAsync(2000);
		expect(edits).toHaveLength(1);
		expect(titleOf(edits[0])).toContain('Restoring');

		gate.resolve();
		await settle();

		// The run cannot finish until that edit resolves
		expect(edits).toHaveLength(1);
		logGate.resolve();
		await running;

		expect(edits).toHaveLength(2);
		expect(titleOf(edits[1])).toBe(`${EMOJI.SUCCESS} Restore complete`);
	});
});

//////////////////
// Shutdown
//////////////////

describe('StopActiveRestores', () => {
	it('is a no-op when nothing is running', async () => {
		await expect(runner.StopActiveRestores()).resolves.toBeUndefined();
		expect(edits).toHaveLength(0);
	});

	it('stops every in-flight run and waits for it to settle', async () => {
		const applyGuild = seedGuild();
		const gate = gateFirstRoleCreate(applyGuild);
		seedRun([roleCreate(1n, 'Mod'), roleCreate(2n, 'Admin')]);
		runner.ClaimRestoreLock(GUILD);

		const running = runner.RunRestore(1, GUILD);
		await settle();

		let stopped = false;
		const shutdown = runner.StopActiveRestores().then(() => { stopped = true });

		await settle();
		expect(stopped).toBe(false); // still waiting on the action in flight

		gate.resolve();
		await running;
		await shutdown;

		expect(stopped).toBe(true);
		expect(applyGuild.spies.rolesCreate).toHaveBeenCalledTimes(1);
		expect(crud.FinishRestoreRun).toHaveBeenCalledWith(1, RESTORE_STATUS.STOPPED, 1);
	});

	it('stops a run that has the lock but has not started yet', async () => {
		const applyGuild = seedGuild();
		seedRun([roleCreate(1n, 'Mod')]);
		runner.ClaimRestoreLock(GUILD);

		await runner.StopActiveRestores();
		await runner.RunRestore(1, GUILD);

		expect(applyGuild.spies.rolesCreate).not.toHaveBeenCalled();
		expect(crud.FinishRestoreRun).toHaveBeenCalledWith(1, RESTORE_STATUS.STOPPED, 0);
	});

	/**
	 * Bug #7: shutdown cannot wait forever, because `index.ts` destroys the client and the pool the
	 * moment this resolves. A run still mid-action when the 15s grace expires is *detached* instead -
	 * it stops writing results, stops editing its log and never calls `FinishRestoreRun`, so its row
	 * stays RUNNING and `ReconcileInterruptedRestores` reports it at the next startup.
	 */
	it('detaches a run that has not settled when the 15s grace expires (Bug #7)', async () => {
		const applyGuild = seedGuild();
		const gate = gateFirstRoleCreate(applyGuild);
		seedRun([roleCreate(1n, 'Mod'), roleCreate(2n, 'Admin')]);
		runner.ClaimRestoreLock(GUILD);

		const running = runner.RunRestore(1, GUILD);
		await settle();

		let stopped = false;
		const shutdown = runner.StopActiveRestores().then(() => { stopped = true });

		await vi.advanceTimersByTimeAsync(14_999);
		expect(stopped).toBe(false);

		await vi.advanceTimersByTimeAsync(1);
		await shutdown;
		expect(stopped).toBe(true);
		expect(LogSpy).toHaveBeenCalledWith('WARN', expect.stringContaining('Restore #1 did not stop within 15000ms'));

		const editsAtDetach = edits.length;

		// The action in flight lands after the client and pool are gone: nothing it would have written
		// is written, and the run closes out in memory only
		gate.resolve();
		await running;

		expect(crud.RecordActionResult).not.toHaveBeenCalled();
		expect(crud.SkipRestoreActions).not.toHaveBeenCalled();
		expect(crud.FinishRestoreRun).not.toHaveBeenCalled();
		expect(guilds.SaveGuild).not.toHaveBeenCalled();
		expect(edits).toHaveLength(editsAtDetach);

		// ...but the guild is released, so a restart is not blocked by a run nobody is driving
		expect(runner.IsRestoreRunning(GUILD)).toBe(false);
	});

	it('does not detach a run that settled inside the grace', async () => {
		const applyGuild = seedGuild();
		const gate = gateFirstRoleCreate(applyGuild);
		seedRun([roleCreate(1n, 'Mod')]);
		runner.ClaimRestoreLock(GUILD);

		const running = runner.RunRestore(1, GUILD);
		await settle();

		const shutdown = runner.StopActiveRestores();

		gate.resolve();
		await running;
		await shutdown;

		expect(crud.FinishRestoreRun).toHaveBeenCalledWith(1, RESTORE_STATUS.STOPPED, 1);
		expect(LogSpy).not.toHaveBeenCalledWith('WARN', expect.stringContaining('detaching'));
	});
});

//////////////////
// Startup reconciliation
//////////////////

describe('ReconcileInterruptedRestores', () => {
	it('does nothing when no run is marked RUNNING', async () => {
		await runner.ReconcileInterruptedRestores();

		expect(crud.MarkRunningRestoresInterrupted).not.toHaveBeenCalled();
		expect(crud.GetRestoreActions).not.toHaveBeenCalled();
		expect(edits).toHaveLength(0);
	});

	it('marks every RUNNING run interrupted and reports each one once', async () => {
		crud.ListRunningRestores.mockResolvedValue([
			record({ id: 1, message_id: 40n }),
			record({ id: 2, message_id: 41n })
		]);
		crud.GetRestoreActions.mockResolvedValue([
			roleCreate(1n, 'Mod'  , { result: RESTORE_RESULT.OK, new_id: 111n }),
			roleCreate(2n, 'Admin', { result: RESTORE_RESULT.SKIPPED })
		]);

		await runner.ReconcileInterruptedRestores();

		expect(crud.MarkRunningRestoresInterrupted).toHaveBeenCalledTimes(1);
		expect(editIDs).toEqual(['40', '41']);
		expect(titleOf(edits[0])).toBe(`${EMOJI.ERROR} Restore interrupted`);
		expect(edits[0].embeds[0].description).toContain('half restored');
		expect(LogSpy).toHaveBeenCalledWith('WARN', expect.stringContaining('interrupted by a restart'));
	});

	it('reads the actions back after they are marked, so the log is not stuck on PENDING', async () => {
		const order: string[] = [];
		crud.ListRunningRestores.mockImplementation(async () => [record({ id: 1 })]);
		crud.MarkRunningRestoresInterrupted.mockImplementation(async () => { order.push('mark') });
		crud.GetRestoreActions.mockImplementation(async () => { order.push('read'); return [] });

		await runner.ReconcileInterruptedRestores();

		expect(order).toEqual(['mark', 'read']);
	});
});
