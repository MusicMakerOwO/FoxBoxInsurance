import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ButtonInteraction, Guild } from 'discord.js';
import {
	COLOR,
	DIFF_CHANGE_TYPE,
	EMOJI,
	RESTORE_OPTIONS,
	RESTORE_RESULT,
	RESTORE_STATUS
} from '../../Utils/Constants.js';
import { GUILD_FEATURES, SnapshotRestoreAction } from '../../Typings/DatabaseTypes.js';
import { ButtonHandler } from '../../Typings/HandlerTypes.js';
import { IClient } from '../../Client.js';
import { HandlerResult, buttonsOf, embedOf } from '../Components/Helpers.js';
import { RESTORE_NOW as NOW, ResetActionSeq, restoreAction as action, restoreRecord as record } from './Fixtures.js';

/**
 * §14 of the test plan: the three buttons that live on the public step log (`restore-stop`,
 * `restore-log`, `restore-retry`) and the completion embed's safety-snapshot button
 * (`restore-safety`). §12 owns screens 01-05 and §11 owns the runner these drive.
 *
 * Kept out of `RestoreHandlers.test.ts` because that file mocks `Services/RestoreRunner.js` down to
 * `{ IsRestoreRunning }`; these handlers need the lock API, `RequestStop`, `RetryRestore` and the real
 * `RunLabel`.
 */

const GUILD_ID = '10'; // `restoreRecord`'s guild_id

vi.mock('../../Client.js', () => ({
	client: { user: { id: '999' }, channels: { cache: new Map() }, guilds: { cache: new Map() } }
}));

const crud = vi.hoisted(() => ({
	FinishRestoreRun             : vi.fn(),
	GetRestoreActions            : vi.fn(),
	GetRestoreRun                : vi.fn(),
	ListRunningRestores          : vi.fn(),
	MarkRunningRestoresInterrupted: vi.fn(),
	RecordActionResult           : vi.fn(),
	ReopenRestoreRun             : vi.fn(),
	SkipRestoreActions           : vi.fn()
}));
vi.mock('../../CRUD/SnapshotRestores.js', () => crud);

vi.mock('../../CRUD/Guilds.js', () => ({ GetGuild: vi.fn(), SaveGuild: vi.fn() }));
vi.mock('../../Services/RestorePlans.js', () => ({ InvalidateRestorePlans: vi.fn() }));

const { UploadCDN } = vi.hoisted(() => ({ UploadCDN: vi.fn() }));
vi.mock('../../Utils/UploadCDN.js', () => ({ UploadCDN }));

// `restore-safety` is a thin wrapper: the manage screen it renders is `Buttons/Snapshots/Manage.ts`'s
// business, and it reaches the DB
const { RenderSnapshotManage } = vi.hoisted(() => ({ RenderSnapshotManage: vi.fn() }));
vi.mock('../../Buttons/Snapshots/Manage.js', () => ({ RenderSnapshotManage, default: {} }));

const { LogSpy } = vi.hoisted(() => ({ LogSpy: vi.fn() }));
vi.mock('../../Utils/Log.js', async (importOriginal) => ({
	...(await importOriginal<typeof import('../../Utils/Log.js')>()),
	Log: LogSpy
}));

/**
 * Only the four entry points these handlers call are stubbed - `RunLabel` stays real, since the
 * refusal copy interpolates it and a stub would hide any drift between the two.
 */
const runner = vi.hoisted(() => ({
	ClaimRestoreLock  : vi.fn(),
	ReleaseRestoreLock: vi.fn(),
	RequestStop       : vi.fn(),
	RetryRestore      : vi.fn()
}));
vi.mock('../../Services/RestoreRunner.js', async (importOriginal) => ({
	...(await importOriginal<typeof import('../../Services/RestoreRunner.js')>()),
	...runner
}));

const RestoreStop   = (await import('../../Buttons/Restore/Stop.js')).default;
const RestoreLog    = (await import('../../Buttons/Restore/Log.js')).default;
const RestoreRetry  = (await import('../../Buttons/Restore/Retry.js')).default;
const RestoreSafety = (await import('../../Buttons/Restore/Safety.js')).default;

//////////////////
// Helpers
//////////////////

function run(handler: ButtonHandler, args: string[], guildId = GUILD_ID): Promise<HandlerResult> {
	const guild = { id: guildId, name: 'Test Guild' } as unknown as Guild;
	const interaction = { guildId, guild } as unknown as ButtonInteraction;

	return handler.execute(interaction, {} as IClient, args);
}

function failedRole(label: string, error = 'above my highest role'): SnapshotRestoreAction {
	return action({
		category   : RESTORE_OPTIONS.ROLES,
		change_type: DIFF_CHANGE_TYPE.CREATE,
		label,
		result     : RESTORE_RESULT.FAILED,
		error
	});
}

/** The text handed to `UploadCDN`, which is the only observable of `RenderLog` */
function uploadedLog(): string {
	const [, buffer] = UploadCDN.mock.calls[0] as [string, Buffer, number];
	return buffer.toString('utf8');
}

beforeEach(() => {
	vi.clearAllMocks();
	ResetActionSeq();

	crud.GetRestoreRun.mockResolvedValue(null);
	crud.GetRestoreActions.mockResolvedValue([]);
	crud.ReopenRestoreRun.mockResolvedValue(undefined);
	runner.ClaimRestoreLock.mockReturnValue(true);
	runner.RequestStop.mockReturnValue(true);
	runner.RetryRestore.mockResolvedValue(undefined);
	UploadCDN.mockResolvedValue('lookup-id');
	RenderSnapshotManage.mockResolvedValue({ embeds: [{ title: 'Snapshot #7' }] });
});

//////////////////
// restore-stop
//////////////////

describe('restore-stop', () => {
	it('asks the runner to stop this run in this guild', async () => {
		const result = await run(RestoreStop, ['9']);

		expect(runner.RequestStop).toHaveBeenCalledWith(9, GUILD_ID);
		expect(embedOf(result).title).toBe(`${EMOJI.STOP} Stopping Restore`);
		expect(embedOf(result).description).toContain('half restored');
	});

	it('says there is nothing to stop when the runner refuses', async () => {
		runner.RequestStop.mockReturnValue(false);

		const result = await run(RestoreStop, ['9']);

		expect(embedOf(result).title).toBe('Nothing To Stop');
		expect(embedOf(result).color).toBe(COLOR.ERROR);
	});

	it('replies rather than updating, so it does not fight the runner for the log message', () => {
		expect(RestoreStop.response_type).toBe('reply');
		expect(RestoreStop.hidden).toBe(true);
	});
});

//////////////////
// restore-log
//////////////////

describe('restore-log', () => {
	it('refuses a run that belongs to another guild', async () => {
		crud.GetRestoreRun.mockResolvedValue(record({ guild_id: 99n }));

		const result = await run(RestoreLog, ['1']);

		expect(embedOf(result).title).toBe('Restore Not Found');
		expect(crud.GetRestoreActions).not.toHaveBeenCalled();
		expect(UploadCDN).not.toHaveBeenCalled();
	});

	it('refuses a run that does not exist', async () => {
		const result = await run(RestoreLog, ['1']);

		expect(embedOf(result).title).toBe('Restore Not Found');
		expect(UploadCDN).not.toHaveBeenCalled();
	});

	it('renders the header off the run row', async () => {
		crud.GetRestoreRun.mockResolvedValue(record({
			status         : RESTORE_STATUS.COMPLETE,
			total_actions  : 4,
			applied_actions: 3,
			finished_at    : BigInt(NOW + 60_000),
			safety_snapshot_id: 7
		}));

		await run(RestoreLog, ['1']);
		const log = uploadedLog();

		expect(log).toContain('Restore #1 - Snapshot #142');
		expect(log).toContain('Server        Test Guild (10)');
		expect(log).toContain('Started by    20');
		expect(log).toContain(`Started       ${new Date(NOW).toISOString()}`);
		expect(log).toContain(`Finished      ${new Date(NOW + 60_000).toISOString()}`);
		expect(log).toContain('Status        Complete');
		expect(log).toContain('Applied       3 / 4');
		expect(log).toContain('Safety        Snapshot #7');
	});

	it('renders a null finished_at as a dash and a missing safety snapshot as a sentence', async () => {
		crud.GetRestoreRun.mockResolvedValue(record({ finished_at: null, safety_snapshot_id: null }));

		await run(RestoreLog, ['1']);
		const log = uploadedLog();

		expect(log).toContain('Finished      -');
		expect(log).toContain('Safety        none - no snapshot was taken before this ran');
	});

	it('labels an import run by its import ID', async () => {
		crud.GetRestoreRun.mockResolvedValue(record({ snapshot_id: null, import_id: 'ABCD-EFGH' }));

		await run(RestoreLog, ['1']);

		expect(uploadedLog()).toContain('Restore #1 - Import #ABCD-EFGH');
	});

	it('groups the failures by cause above the action list', async () => {
		crud.GetRestoreRun.mockResolvedValue(record());
		crud.GetRestoreActions.mockResolvedValue([
			failedRole('@Mod'),
			failedRole('@Admin'),
			failedRole('@Helper', 'role limit reached')
		]);

		await run(RestoreLog, ['1']);
		const log = uploadedLog();

		expect(log).toContain('FAILURES BY CAUSE');
		expect(log).toContain('2 roles - above my highest role');
		expect(log).toContain('1 role - role limit reached');
		// Biggest cause first, and the whole block sits above the action list
		expect(log.indexOf('2 roles')).toBeLessThan(log.indexOf('1 role -'));
		expect(log.indexOf('FAILURES BY CAUSE')).toBeLessThan(log.indexOf('ACTIONS'));
	});

	it('omits the failures block entirely when nothing failed', async () => {
		crud.GetRestoreRun.mockResolvedValue(record());
		crud.GetRestoreActions.mockResolvedValue([action({ result: RESTORE_RESULT.OK })]);

		await run(RestoreLog, ['1']);

		expect(uploadedLog()).not.toContain('FAILURES BY CAUSE');
	});

	it('renders one line per action, with the new ID and the error appended', async () => {
		crud.GetRestoreRun.mockResolvedValue(record());
		crud.GetRestoreActions.mockResolvedValue([
			action({ seq: 0, category: RESTORE_OPTIONS.ROLES, change_type: DIFF_CHANGE_TYPE.CREATE, label: '@Mod', result: RESTORE_RESULT.OK, new_id: 555n }),
			action({ seq: 1, category: RESTORE_OPTIONS.CHANNELS, change_type: DIFF_CHANGE_TYPE.DELETE, label: '#old', result: RESTORE_RESULT.SKIPPED, error: 'channel no longer exists' }),
			action({ seq: 2, category: RESTORE_OPTIONS.BANS, change_type: DIFF_CHANGE_TYPE.UPDATE, label: '<@40>', result: RESTORE_RESULT.PENDING })
		]);

		await run(RestoreLog, ['1']);
		const lines = uploadedLog().split('\n');

		expect(lines).toContain('   0  OK       + ROLE     @Mod  ->  555');
		expect(lines).toContain('   1  SKIPPED  − CHANNEL  #old  ::  channel no longer exists');
		expect(lines).toContain('   2  PENDING  ~ BAN      <@40>');
	});

	it('uploads a single-use download and reports its size', async () => {
		crud.GetRestoreRun.mockResolvedValue(record());
		crud.GetRestoreActions.mockResolvedValue([action({ result: RESTORE_RESULT.OK })]);

		const result = await run(RestoreLog, ['1']);

		expect(UploadCDN).toHaveBeenCalledWith('restore-log-1.txt', expect.any(Buffer), 1);
		expect(embedOf(result).description).toContain('lookup-id');
		expect(embedOf(result).description).toContain('**Actions:** 1');
		expect(buttonsOf(result)[0]).toMatchObject({ style: 5, url: 'https://cdn.notfbi.dev/download/lookup-id' });
	});
});

//////////////////
// restore-retry
//////////////////

describe('restore-retry', () => {
	it('refuses a run that belongs to another guild', async () => {
		crud.GetRestoreRun.mockResolvedValue(record({ guild_id: 99n, status: RESTORE_STATUS.FAILED }));

		const result = await run(RestoreRetry, ['1']);

		expect(embedOf(result).title).toBe('Restore Not Found');
		expect(runner.ClaimRestoreLock).not.toHaveBeenCalled();
		expect(runner.RetryRestore).not.toHaveBeenCalled();
	});

	it('refuses a run that did not end with failures, naming the snapshot to restore instead', async () => {
		crud.GetRestoreRun.mockResolvedValue(record({ status: RESTORE_STATUS.STOPPED }));

		const result = await run(RestoreRetry, ['1']);

		expect(embedOf(result).title).toBe('Nothing To Retry');
		expect(embedOf(result).description).toContain('Snapshot #142');
		expect(crud.GetRestoreActions).not.toHaveBeenCalled();
		expect(runner.ClaimRestoreLock).not.toHaveBeenCalled();
	});

	it('refuses a FAILED run whose failures have since been resolved', async () => {
		crud.GetRestoreRun.mockResolvedValue(record({ status: RESTORE_STATUS.FAILED }));
		crud.GetRestoreActions.mockResolvedValue([]);

		const result = await run(RestoreRetry, ['1']);

		expect(crud.GetRestoreActions).toHaveBeenCalledWith(1, RESTORE_RESULT.FAILED);
		expect(embedOf(result).description).toContain('since been resolved');
		expect(runner.ClaimRestoreLock).not.toHaveBeenCalled();
	});

	it('refuses when the guild lock is already held', async () => {
		crud.GetRestoreRun.mockResolvedValue(record({ status: RESTORE_STATUS.FAILED }));
		crud.GetRestoreActions.mockResolvedValue([failedRole('@Mod')]);
		runner.ClaimRestoreLock.mockReturnValue(false);

		const result = await run(RestoreRetry, ['1']);

		expect(embedOf(result).title).toBe('Restore In Progress');
		expect(crud.ReopenRestoreRun).not.toHaveBeenCalled();
		expect(runner.RetryRestore).not.toHaveBeenCalled();
	});

	it('claims the lock before reopening the run, so a second click cannot start a second retry', async () => {
		crud.GetRestoreRun.mockResolvedValue(record({ status: RESTORE_STATUS.FAILED }));
		crud.GetRestoreActions.mockResolvedValue([failedRole('@Mod')]);

		const order: string[] = [];
		runner.ClaimRestoreLock.mockImplementation(() => { order.push('claim'); return true });
		crud.ReopenRestoreRun.mockImplementation(async () => { order.push('reopen') });

		await run(RestoreRetry, ['1']);

		expect(order).toEqual(['claim', 'reopen']);
	});

	it('releases the lock when the run cannot be reopened', async () => {
		crud.GetRestoreRun.mockResolvedValue(record({ status: RESTORE_STATUS.FAILED }));
		crud.GetRestoreActions.mockResolvedValue([failedRole('@Mod')]);
		crud.ReopenRestoreRun.mockRejectedValue(new Error('deadlock'));

		const result = await run(RestoreRetry, ['1']);

		expect(embedOf(result).title).toBe('Could Not Start Retry');
		expect(runner.ReleaseRestoreLock).toHaveBeenCalledWith(GUILD_ID);
		expect(runner.RetryRestore).not.toHaveBeenCalled();
		expect(LogSpy).toHaveBeenCalledWith('ERROR', expect.any(Error));
	});

	it('starts the retry without awaiting it and reports how many actions will replay', async () => {
		crud.GetRestoreRun.mockResolvedValue(record({ status: RESTORE_STATUS.FAILED }));
		crud.GetRestoreActions.mockResolvedValue([failedRole('@Mod'), failedRole('@Admin')]);

		// A retry runs for minutes - if the handler awaited it, the interaction would time out
		const gate = new Promise<void>(() => {});
		runner.RetryRestore.mockReturnValue(gate);

		const result = await run(RestoreRetry, ['1']);

		expect(crud.ReopenRestoreRun).toHaveBeenCalledWith(1);
		expect(runner.RetryRestore).toHaveBeenCalledWith(1, GUILD_ID);
		expect(embedOf(result).title).toBe(`${EMOJI.RESTORE} Retrying Restore`);
		expect(embedOf(result).description).toContain('**2** failed actions');
	});

	it('says "action" for a single failure', async () => {
		crud.GetRestoreRun.mockResolvedValue(record({ status: RESTORE_STATUS.FAILED }));
		crud.GetRestoreActions.mockResolvedValue([failedRole('@Mod')]);

		const result = await run(RestoreRetry, ['1']);

		expect(embedOf(result).description).toContain('**1** failed action from');
	});

	it('replies rather than updating, so it does not fight the runner for the log message', () => {
		expect(RestoreRetry.response_type).toBe('reply');
		expect(RestoreRetry.hidden).toBe(true);
	});
});

//////////////////
// restore-safety
//////////////////

describe('restore-safety', () => {
	it('returns the manage screen for the safety snapshot', async () => {
		const result = await run(RestoreSafety, ['7']);

		expect(RenderSnapshotManage).toHaveBeenCalledWith(GUILD_ID, '7');
		expect(embedOf(result).title).toBe('Snapshot #7');
	});

	/**
	 * Bug #4: this button replaced `snapshot-manage` on the completion embed precisely because
	 * updating would consume the public step log, and because a guild with restore enabled must be
	 * able to reach its rollback snapshot without also holding MANAGE_SNAPSHOTS.
	 */
	it('replies rather than updating, and is gated on RESTORE_SNAPSHOTS', () => {
		expect(RestoreSafety.response_type).toBe('reply');
		expect(RestoreSafety.hidden).toBe(true);
		expect(RestoreSafety.guild_features).toEqual([ GUILD_FEATURES.RESTORE_SNAPSHOTS ]);
	});
});
