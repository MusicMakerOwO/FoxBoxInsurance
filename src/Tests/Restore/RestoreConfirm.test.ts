import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ModalSubmitInteraction } from 'discord.js';
import {
	DIFF_CHANGE_TYPE,
	RESTORE_OPTIONS,
	RESTORE_STATUS,
	SNAPSHOT_TYPE
} from '../../Utils/Constants.js';
import { DiscordPermissions } from '../../Utils/DiscordConstants.js';
import { IClient } from '../../Client.js';
import { BOT_USER_ID, GUILD_ID, makeGuild } from './Fixtures.js';

/**
 * §13 of the test plan: the confirm modal's shape (`Buttons/Restore/Confirm.ts`) and its submit
 * (`Modals/RestoreStart.ts`) - every refuse branch, in file order, plus the happy path and the
 * catch-all.
 *
 * `CRUD/SnapshotRestores.ts` is mocked, so what is asserted here is the hand-off: which run fields
 * and which actions the handler passes to `CreateRestoreRun`. What that module then does with them
 * is `SnapshotRestores.test.ts`'s job. The checklist's `db`-kind lines are closed out as a scope
 * call - `npm test` has no database, and the live path is covered by the §16 manual script.
 */

vi.mock('../../Client.js', () => ({
	client: { user: { id: BOT_USER_ID }, channels: { cache: new Map() }, guilds: { cache: new Map() } }
}));

const { GetImportsForGuild } = vi.hoisted(() => ({ GetImportsForGuild: vi.fn() }));
vi.mock('../../CRUD/SnapshotImports.js', () => ({ GetImportsForGuild }));

const { GetSnapshot, CreateSnapshot, SetSnapshotPinStatus } = vi.hoisted(() => ({
	GetSnapshot: vi.fn(),
	CreateSnapshot: vi.fn(),
	SetSnapshotPinStatus: vi.fn()
}));
vi.mock('../../CRUD/Snapshots.js', () => ({ GetSnapshot, CreateSnapshot, SetSnapshotPinStatus }));

const { CreateRestoreRun, SetRestoreMessage, FinishRestoreRun } = vi.hoisted(() => ({
	CreateRestoreRun: vi.fn(),
	SetRestoreMessage: vi.fn(),
	FinishRestoreRun: vi.fn()
}));
vi.mock('../../CRUD/SnapshotRestores.js', () => ({ CreateRestoreRun, SetRestoreMessage, FinishRestoreRun }));

const { IsRestoreRunning, ClaimRestoreLock, ReleaseRestoreLock, RunRestore } = vi.hoisted(() => ({
	IsRestoreRunning: vi.fn(),
	ClaimRestoreLock: vi.fn(),
	ReleaseRestoreLock: vi.fn(),
	RunRestore: vi.fn()
}));
vi.mock('../../Services/RestoreRunner.js', () => ({ IsRestoreRunning, ClaimRestoreLock, ReleaseRestoreLock, RunRestore }));

/**
 * `RestorePlanError` is kept real - `RestoreStart.ts` branches on `instanceof`, and a stubbed class
 * would make that branch untestable.
 */
const { BuildRestorePlan, GetCachedPlan, InvalidateRestorePlans } = vi.hoisted(() => ({
	BuildRestorePlan: vi.fn(),
	GetCachedPlan: vi.fn(),
	InvalidateRestorePlans: vi.fn()
}));
vi.mock('../../Services/RestorePlans.js', async (importOriginal) => {
	const actual = await importOriginal<typeof import('../../Services/RestorePlans.js')>();
	return { ...actual, BuildRestorePlan, GetCachedPlan, InvalidateRestorePlans };
});

const { LogSpy } = vi.hoisted(() => ({ LogSpy: vi.fn() }));
vi.mock('../../Utils/Log.js', async (importOriginal) => ({
	...(await importOriginal<typeof import('../../Utils/Log.js')>()), Log: LogSpy
}));

const { RestorePlanError } = await import('../../Services/RestorePlans.js');
type RestoreAction = import('../../Services/RestorePlans.js').RestoreAction;
type RestorePlan = import('../../Services/RestorePlans.js').RestorePlan;

const RestoreConfirm = (await import('../../Buttons/Restore/Confirm.js')).default;
const RestoreStart = (await import('../../Modals/RestoreStart.js')).default;

type ConfirmResult = Awaited<ReturnType<typeof RestoreConfirm.execute>>;

/** `restore-confirm` always returns a modal - narrows away the `InteractionResponse` half of the union */
function modal(result: ConfirmResult) {
	if (!('title' in result)) throw new Error('expected a modal');
	return result;
}

//////////////////
// Helpers
//////////////////

const SNAPSHOT_ID = '5';
const MASK = 7;

function planAction(label = '@Mod'): RestoreAction {
	return {
		category: RESTORE_OPTIONS.ROLES,
		change_type: DIFF_CHANGE_TYPE.UPDATE,
		target_id: 100n,
		label,
		payload: { id: 100n, permissions: 8n }
	} as unknown as RestoreAction;
}

function makePlan(overrides: Partial<RestorePlan> = {}): RestorePlan {
	return {
		snapshot_id: SNAPSHOT_ID,
		guild_id: GUILD_ID,
		mask: MASK,
		actions: [planAction()],
		warnings: [],
		fingerprint: 'fingerprint-a',
		created_at: 0,
		...overrides
	};
}

/** Bare guild that holds all three restore permissions, unless overridden per test */
function bareGuild(permissions?: bigint[]) {
	const guild = makeGuild([], [], permissions === undefined ? { id: GUILD_ID } : { id: GUILD_ID, permissions });
	Object.assign(guild, { name: 'Fox Box HQ' });
	return guild;
}

type FakeChannel = { id: string, isSendable: () => boolean, send: ReturnType<typeof vi.fn> };

function sendableChannel(): FakeChannel {
	return {
		id: '30',
		isSendable: () => true,
		send: vi.fn().mockResolvedValue({ id: '40', url: 'https://discord.com/channels/1/30/40' })
	};
}

function makeInteraction(options: {
	guild: ReturnType<typeof bareGuild>,
	typedName?: string,
	channel?: FakeChannel | null,
	userId?: string,
	userTag?: string
}): ModalSubmitInteraction {
	const { guild, typedName = guild.name, channel = sendableChannel(), userId = '900', userTag = 'Admin#0001' } = options;

	return {
		guild,
		channel,
		user: { id: userId, tag: userTag },
		fields: { getTextInputValue: vi.fn().mockReturnValue(typedName) }
	} as unknown as ModalSubmitInteraction;
}

function run(interaction: ModalSubmitInteraction, args: string[] = [SNAPSHOT_ID, String(MASK)]) {
	return RestoreStart.execute(interaction, {} as IClient, args);
}

beforeEach(() => {
	GetImportsForGuild.mockReset();
	GetImportsForGuild.mockReturnValue(new Map());
	GetSnapshot.mockReset();
	GetSnapshot.mockResolvedValue({ id: Number(SNAPSHOT_ID), guild_id: BigInt(GUILD_ID), type: SNAPSHOT_TYPE.MANUAL });
	CreateSnapshot.mockReset();
	CreateSnapshot.mockResolvedValue(143);
	SetSnapshotPinStatus.mockReset();
	SetSnapshotPinStatus.mockResolvedValue(undefined);
	CreateRestoreRun.mockReset();
	CreateRestoreRun.mockResolvedValue(1);
	SetRestoreMessage.mockReset();
	SetRestoreMessage.mockResolvedValue(undefined);
	FinishRestoreRun.mockReset();
	FinishRestoreRun.mockResolvedValue(undefined);
	IsRestoreRunning.mockReset();
	IsRestoreRunning.mockReturnValue(false);
	ClaimRestoreLock.mockReset();
	ClaimRestoreLock.mockReturnValue(true);
	ReleaseRestoreLock.mockReset();
	RunRestore.mockReset();
	RunRestore.mockReturnValue(new Promise(() => {})); // never resolves - fire-and-forget must not be awaited
	BuildRestorePlan.mockReset();
	BuildRestorePlan.mockResolvedValue(makePlan());
	GetCachedPlan.mockReset();
	GetCachedPlan.mockReturnValue(makePlan());
	InvalidateRestorePlans.mockReset();
	LogSpy.mockReset();
});

//////////////////
// Confirm.ts - the modal's shape
//////////////////

describe('Buttons/Restore/Confirm', () => {
	it('carries the snapshot and mask into the modal submit custom_id', async () => {
		GetCachedPlan.mockReturnValue(makePlan());
		const interaction = { guildId: GUILD_ID, guild: bareGuild() } as unknown as Parameters<typeof RestoreConfirm.execute>[0];

		const result = modal(await RestoreConfirm.execute(interaction, {} as IClient, [SNAPSHOT_ID, String(MASK)]));

		expect(result.custom_id).toBe(`restore-start_${SNAPSHOT_ID}_${MASK}`);
	});

	it('still opens on a cache miss, with a generic title, and does not throw', async () => {
		GetCachedPlan.mockReturnValue(null);
		const interaction = { guildId: GUILD_ID, guild: bareGuild() } as unknown as Parameters<typeof RestoreConfirm.execute>[0];

		const result = modal(await RestoreConfirm.execute(interaction, {} as IClient, [SNAPSHOT_ID, String(MASK)]));

		expect(result.title).toBe('Confirm restore');
	});

	it('truncates the title and label description to Discord\'s modal caps on a 100-char guild name', async () => {
		GetCachedPlan.mockReturnValue(makePlan({ actions: Array.from({ length: 1234 }, () => planAction()) }));
		const guild = bareGuild();
		Object.assign(guild, { name: 'G'.repeat(100) });
		const interaction = { guildId: GUILD_ID, guild } as unknown as Parameters<typeof RestoreConfirm.execute>[0];

		const result = modal(await RestoreConfirm.execute(interaction, {} as IClient, [SNAPSHOT_ID, String(MASK)]));

		expect(result.title.length).toBeLessThanOrEqual(45);
		const label = result.components![0] as unknown as { description: string };
		expect(label.description.length).toBeLessThanOrEqual(100);
	});
});

//////////////////
// RestoreStart.ts - refuse paths, in file order
//////////////////

describe('Modals/RestoreStart - refuse paths', () => {
	it('refuses a name mismatch before touching anything else', async () => {
		const guild = bareGuild();
		const interaction = makeInteraction({ guild, typedName: 'wrong name' });

		const result = await run(interaction);

		expect(result.embeds![0].title).toBe('Name Did Not Match');
		expect(CreateSnapshot).not.toHaveBeenCalled();
		expect(ClaimRestoreLock).not.toHaveBeenCalled();
		expect(CreateRestoreRun).not.toHaveBeenCalled();
	});

	it('accepts the name trimmed and case-insensitively', async () => {
		const guild = bareGuild();
		const interaction = makeInteraction({ guild, typedName: '  fox box hq  ' });

		await run(interaction);

		expect(ClaimRestoreLock).toHaveBeenCalledWith(GUILD_ID);
	});

	it('refuses while a restore is already running, before any snapshot lookup', async () => {
		IsRestoreRunning.mockReturnValue(true);
		const guild = bareGuild();
		const interaction = makeInteraction({ guild });

		const result = await run(interaction);

		expect(result.embeds![0].title).toBe('Restore In Progress');
		expect(GetSnapshot).not.toHaveBeenCalled();
	});

	it('refuses when the snapshot/import vanished between preview and submit', async () => {
		GetSnapshot.mockResolvedValue(null);
		const interaction = makeInteraction({ guild: bareGuild() });

		const result = await run(interaction);

		expect(result.embeds![0].title).toBe('Snapshot Not Found');
	});

	it("refuses another guild's stored snapshot", async () => {
		GetSnapshot.mockResolvedValue({ id: Number(SNAPSHOT_ID), guild_id: BigInt(GUILD_ID) + 1n, type: SNAPSHOT_TYPE.MANUAL });

		const result = await run(makeInteraction({ guild: bareGuild() }));

		expect(result.embeds![0].title).toBe('Snapshot Not Found');
		expect(CreateRestoreRun).not.toHaveBeenCalled();
	});

	it('an expired import whose id starts with digits never resolves to a stored snapshot', async () => {
		GetImportsForGuild.mockReturnValue(new Map());
		GetSnapshot.mockResolvedValue({ id: 2345, guild_id: BigInt(GUILD_ID), type: SNAPSHOT_TYPE.MANUAL });

		const result = await run(makeInteraction({ guild: bareGuild() }), [ '2345-ABCD-EFGH-JKLM', String(MASK) ]);

		expect(result.embeds![0].title).toBe('Snapshot Not Found');
		expect(GetSnapshot).not.toHaveBeenCalled();
		expect(CreateRestoreRun).not.toHaveBeenCalled();
	});

	it('refuses when the cached preview expired', async () => {
		GetCachedPlan.mockReturnValue(null);
		const interaction = makeInteraction({ guild: bareGuild() });

		const result = await run(interaction);

		expect(result.embeds![0].title).toBe('Preview Expired');
		expect(BuildRestorePlan).not.toHaveBeenCalled();
	});

	it('refuses on a stale fingerprint and evicts the cache again', async () => {
		GetCachedPlan.mockReturnValue(makePlan({ fingerprint: 'fingerprint-a' }));
		BuildRestorePlan.mockResolvedValue(makePlan({ fingerprint: 'fingerprint-b' }));
		const interaction = makeInteraction({ guild: bareGuild() });

		const result = await run(interaction);

		expect(result.embeds![0].title).toBe('The Server Changed');
		expect(InvalidateRestorePlans).toHaveBeenCalledWith(GUILD_ID, SNAPSHOT_ID, MASK);
		expect(InvalidateRestorePlans).toHaveBeenCalledTimes(2); // once before rebuild, once on the mismatch
	});

	// Bug #3 regression pin: a second submit after a stale refusal must still refuse, not run the
	// rebuilt plan the admin never actually confirmed against
	it('still refuses on a second submit after a stale refusal', async () => {
		GetCachedPlan.mockReturnValue(makePlan({ fingerprint: 'fingerprint-a' }));
		BuildRestorePlan.mockResolvedValue(makePlan({ fingerprint: 'fingerprint-b' }));
		const guild = bareGuild();

		const first = await run(makeInteraction({ guild }));
		const second = await run(makeInteraction({ guild }));

		expect(first.embeds![0].title).toBe('The Server Changed');
		expect(second.embeds![0].title).toBe('The Server Changed');
		expect(CreateRestoreRun).not.toHaveBeenCalled();
	});

	it('renders a RestorePlanError as an embed, never a stack trace', async () => {
		BuildRestorePlan.mockRejectedValue(new RestorePlanError('this snapshot has no role matching this bot'));
		const interaction = makeInteraction({ guild: bareGuild() });

		const result = await run(interaction);

		expect(result.embeds![0].title).toBe('Could Not Build Restore Plan');
		expect(result.embeds![0].description).toBe('this snapshot has no role matching this bot');
	});

	it('rethrows anything that is not a RestorePlanError', async () => {
		BuildRestorePlan.mockRejectedValue(new TypeError('boom'));
		const interaction = makeInteraction({ guild: bareGuild() });

		await expect(run(interaction)).rejects.toThrow('boom');
	});

	it('refuses when the rebuilt plan is empty', async () => {
		BuildRestorePlan.mockResolvedValue(makePlan({ actions: [], fingerprint: 'fingerprint-a' }));
		GetCachedPlan.mockReturnValue(makePlan({ actions: [], fingerprint: 'fingerprint-a' }));
		const interaction = makeInteraction({ guild: bareGuild() });

		const result = await run(interaction);

		expect(result.embeds![0].title).toBe('Nothing To Restore');
	});

	it('refuses in a non-sendable channel, before claiming the lock', async () => {
		const interaction = makeInteraction({ guild: bareGuild(), channel: { id: '30', isSendable: () => false, send: vi.fn() } });

		const result = await run(interaction);

		expect(result.embeds![0].title).toBe('Cannot Post Here');
		expect(ClaimRestoreLock).not.toHaveBeenCalled();
	});

	it('refuses when missing bot permissions, naming exactly what is absent (Bug #12)', async () => {
		const guild = bareGuild([DiscordPermissions.ManageChannels, DiscordPermissions.BanMembers]);
		const interaction = makeInteraction({ guild });

		const result = await run(interaction);

		expect(result.embeds![0].title).toBe('Missing Permissions');
		expect(result.embeds![0].description).toContain('**Missing:** `Manage Roles`');
		expect(ClaimRestoreLock).not.toHaveBeenCalled();
		expect(CreateSnapshot).not.toHaveBeenCalled();
	});

	it('proceeds when all three permissions are held', async () => {
		const interaction = makeInteraction({ guild: bareGuild() });

		const result = await run(interaction);

		expect(result.embeds![0].title).not.toBe('Missing Permissions');
	});

	it('refuses when the lock claim loses the race', async () => {
		ClaimRestoreLock.mockReturnValue(false);
		const interaction = makeInteraction({ guild: bareGuild() });

		const result = await run(interaction);

		expect(result.embeds![0].title).toBe('Restore In Progress');
		expect(CreateSnapshot).not.toHaveBeenCalled();
	});

	it('refuses when the safety snapshot fails, releasing the lock and logging', async () => {
		CreateSnapshot.mockRejectedValue(new Error('disk full'));
		const interaction = makeInteraction({ guild: bareGuild() });

		const result = await run(interaction);

		expect(result.embeds![0].title).toBe('Safety Snapshot Failed');
		expect(ReleaseRestoreLock).toHaveBeenCalledWith(GUILD_ID);
		expect(LogSpy).toHaveBeenCalledWith('ERROR', expect.any(Error));
		expect(CreateRestoreRun).not.toHaveBeenCalled();
	});
});

//////////////////
// Happy path and catch-all
//////////////////

describe('Modals/RestoreStart - happy path', () => {
	it('tolerates a pin failure, warning about rotation in the reply', async () => {
		SetSnapshotPinStatus.mockRejectedValue(new Error('slots full'));
		const interaction = makeInteraction({ guild: bareGuild() });

		const result = await run(interaction);

		expect(result.embeds![0].title).toBe('Restore Started');
		expect(result.embeds![0].description).toContain('I could not pin it');
	});

	it('discriminates snapshot_id vs import_id and writes the run + message id', async () => {
		GetSnapshot.mockResolvedValue({ id: Number(SNAPSHOT_ID), guild_id: BigInt(GUILD_ID), type: SNAPSHOT_TYPE.MANUAL });
		const interaction = makeInteraction({ guild: bareGuild() });

		const result = await run(interaction);

		expect(CreateRestoreRun).toHaveBeenCalledWith(
			expect.objectContaining({
				guild_id: BigInt(GUILD_ID),
				snapshot_id: Number(SNAPSHOT_ID),
				import_id: null,
				safety_snapshot_id: 143,
				channel_id: 30n,
				mask: MASK
			}),
			// The plan's actions reach the CRUD layer intact, bigints included - the handler neither
			// reshapes nor pre-serializes them, which is what lets `CreateRestoreRun` own that
			[expect.objectContaining({
				category: RESTORE_OPTIONS.ROLES,
				change_type: DIFF_CHANGE_TYPE.UPDATE,
				target_id: 100n,
				label: '@Mod',
				payload: { id: 100n, permissions: 8n }
			})]
		);
		expect(SetRestoreMessage).toHaveBeenCalledWith(1, 40n);
		expect(result.embeds![0].title).toBe('Restore Started');
	});

	it('discriminates an import id as import_id, not snapshot_id', async () => {
		const importID = 'ABCD-0000';
		GetImportsForGuild.mockReturnValue(new Map([[importID, { id: importID, type: SNAPSHOT_TYPE.IMPORT }]]));
		const interaction = makeInteraction({ guild: bareGuild() });

		await run(interaction, [importID, String(MASK)]);

		expect(CreateRestoreRun).toHaveBeenCalledWith(
			expect.objectContaining({ snapshot_id: null, import_id: importID }),
			expect.any(Array)
		);
	});

	it('fires the runner without awaiting it - execute resolves while the run is still pending', async () => {
		const interaction = makeInteraction({ guild: bareGuild() });

		const result = await run(interaction);

		expect(RunRestore).toHaveBeenCalledWith(1, GUILD_ID);
		expect(result.embeds![0].title).toBe('Restore Started');
	});
});

describe('Modals/RestoreStart - catch-all', () => {
	it('marks the run FAILED, releases the lock, and rethrows when a write fails after the run row exists', async () => {
		SetRestoreMessage.mockRejectedValue(new Error('connection reset'));
		const interaction = makeInteraction({ guild: bareGuild() });

		await expect(run(interaction)).rejects.toThrow('connection reset');

		expect(FinishRestoreRun).toHaveBeenCalledWith(1, RESTORE_STATUS.FAILED, 0);
		expect(ReleaseRestoreLock).toHaveBeenCalledWith(GUILD_ID);
	});
});

//////////////////
// Handler metadata
//////////////////

describe('Modals/RestoreStart - metadata', () => {
	it('is a hidden reply, so the public preview screen it was pressed from survives', () => {
		expect(RestoreStart.response_type).toBe('reply');
		expect(RestoreStart.hidden).toBe(true);
	});

	it('requires Administrator and both TOS/guild-feature gates', () => {
		expect(RestoreStart.permissions).toContain(DiscordPermissions.Administrator);
		expect(RestoreStart.guild_features).toHaveLength(1);
		expect(RestoreStart.tos_features).toHaveLength(1);
	});
});
