import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ModalSubmitInteraction } from 'discord.js';
import { Database } from '../../Database.js';
import { DIFF_CHANGE_TYPE, RESTORE_OPTIONS, SNAPSHOT_TYPE } from '../../Utils/Constants.js';
import { GetRestoreActions, GetRestoreRun } from '../../CRUD/SnapshotRestores.js';
import { IClient } from '../../Client.js';

/**
 * The one `db`-kind line left open in the §13 checklist: `RestoreStart.ts`'s happy path, against a
 * real `CRUD/SnapshotRestores.ts` rather than the mocked version `RestoreConfirm.test.ts` uses -
 * proving `CreateRestoreRun`/`SetRestoreMessage` survive MariaDB's real JSON-column/BigInt driver
 * behavior when called from the handler, not just from `SnapshotRestores.test.ts`'s direct calls.
 *
 * Everything upstream of the DB write (the plan, the safety snapshot, the lock) is mocked, same as
 * `RestoreConfirm.test.ts` - this file's only job is the write path, not a second copy of the refuse
 * branches or the plan-building logic.
 */

vi.mock('../../Client.js', () => ({
	client: { user: { id: '999' }, channels: { cache: new Map() }, guilds: { cache: new Map() } }
}));

vi.mock('../../CRUD/SnapshotImports.js', () => ({ GetImportsForGuild: vi.fn().mockReturnValue(new Map()) }));

const { GetSnapshot, CreateSnapshot, SetSnapshotPinStatus } = vi.hoisted(() => ({
	GetSnapshot: vi.fn(),
	CreateSnapshot: vi.fn(),
	SetSnapshotPinStatus: vi.fn()
}));
vi.mock('../../CRUD/Snapshots.js', () => ({ GetSnapshot, CreateSnapshot, SetSnapshotPinStatus }));

const { IsRestoreRunning, ClaimRestoreLock, ReleaseRestoreLock, RunRestore } = vi.hoisted(() => ({
	IsRestoreRunning: vi.fn(),
	ClaimRestoreLock: vi.fn(),
	ReleaseRestoreLock: vi.fn(),
	RunRestore: vi.fn()
}));
vi.mock('../../Services/RestoreRunner.js', () => ({ IsRestoreRunning, ClaimRestoreLock, ReleaseRestoreLock, RunRestore }));

const { BuildRestorePlan, GetCachedPlan, InvalidateRestorePlans } = vi.hoisted(() => ({
	BuildRestorePlan: vi.fn(),
	GetCachedPlan: vi.fn(),
	InvalidateRestorePlans: vi.fn()
}));
vi.mock('../../Services/RestorePlans.js', async (importOriginal) => {
	const actual = await importOriginal<typeof import('../../Services/RestorePlans.js')>();
	return { ...actual, BuildRestorePlan, GetCachedPlan, InvalidateRestorePlans };
});

vi.mock('../../Utils/Log.js', async (importOriginal) => ({
	...(await importOriginal<typeof import('../../Utils/Log.js')>()), Log: vi.fn()
}));

const RestoreStart = (await import('../../Modals/RestoreStart.js')).default;

let guildID: bigint;
async function makeGuild(): Promise<bigint> {
	const id = 900_000_000_000_000_000n + BigInt(Date.now());
	await Database.query('INSERT INTO Guilds (id, name, features) VALUES (?, ?, ?)', [id, 'Restore start DB test guild', 0]);
	return id;
}

beforeEach(async () => {
	guildID = await makeGuild();

	GetSnapshot.mockReset().mockResolvedValue({ id: 5, type: SNAPSHOT_TYPE.MANUAL });
	CreateSnapshot.mockReset().mockResolvedValue(143);
	SetSnapshotPinStatus.mockReset().mockResolvedValue(undefined);
	IsRestoreRunning.mockReset().mockReturnValue(false);
	ClaimRestoreLock.mockReset().mockReturnValue(true);
	ReleaseRestoreLock.mockReset();
	RunRestore.mockReset().mockReturnValue(new Promise(() => {})); // fire-and-forget, never resolves

	const plan = {
		snapshot_id: '5',
		guild_id: String(guildID),
		mask: RESTORE_OPTIONS.ROLES,
		actions: [{
			category: RESTORE_OPTIONS.ROLES,
			change_type: DIFF_CHANGE_TYPE.UPDATE,
			target_id: 100n,
			label: '@Mod',
			payload: { id: 100n, name: 'Mod', color: 0, hoist: 0, position: 1, permissions: 8n, managed_by: null }
		}],
		warnings: [],
		fingerprint: 'fingerprint-a',
		created_at: 0
	};
	BuildRestorePlan.mockReset().mockResolvedValue(plan);
	GetCachedPlan.mockReset().mockReturnValue(plan);
	InvalidateRestorePlans.mockReset();
});

afterEach(async () => {
	await Database.query('DELETE FROM Guilds WHERE id = ?', [guildID]);
});

function makeInteraction(): ModalSubmitInteraction {
	const guild = {
		id: String(guildID),
		name: 'Restore start DB test guild',
		members: { me: { permissions: { has: () => true } } }
	};
	const channel = {
		id: '30',
		isSendable: () => true,
		send: vi.fn().mockResolvedValue({ id: '40', url: 'https://discord.com/channels/1/30/40' })
	};

	return {
		guild,
		channel,
		user: { id: '900', tag: 'Admin#0001' },
		fields: { getTextInputValue: vi.fn().mockReturnValue(guild.name) }
	} as unknown as ModalSubmitInteraction;
}

describe('Modals/RestoreStart - happy path against a real database', () => {
	it('writes a real SnapshotRestores run row, one action row per plan action, and the message id', async () => {
		const interaction = makeInteraction();

		const result = await RestoreStart.execute(interaction, {} as IClient, ['5', String(RESTORE_OPTIONS.ROLES)]);

		expect(result.embeds![0].title).toBe('Restore Started');

		// The run ID is whatever the auto-increment produced - look it up by guild rather than assuming 1
		const rows = await Database.query('SELECT id FROM SnapshotRestores WHERE guild_id = ?', [guildID]) as { id: number }[];
		expect(rows).toHaveLength(1);
		const restoreID = rows[0].id;

		const persisted = await GetRestoreRun(restoreID);
		expect(persisted).not.toBeNull();
		expect(persisted!.guild_id).toBe(guildID);
		expect(persisted!.snapshot_id).toBe(5);
		expect(persisted!.import_id).toBeNull();
		expect(persisted!.safety_snapshot_id).toBe(143);
		expect(persisted!.channel_id).toBe(30n);
		expect(persisted!.mask).toBe(RESTORE_OPTIONS.ROLES);
		expect(persisted!.message_id).toBe(40n);
		expect(persisted!.total_actions).toBe(1);

		const actions = await GetRestoreActions(restoreID);
		expect(actions).toHaveLength(1);
		expect(actions[0].label).toBe('@Mod');
		expect(actions[0].target_id).toBe(100n);
		expect((actions[0].payload as { permissions: bigint }).permissions).toBe(8n);
	});

	it('discriminates an import id as import_id, not snapshot_id, in the real row', async () => {
		const importID = 'ABCD-0000';
		const { GetImportsForGuild } = await import('../../CRUD/SnapshotImports.js');
		vi.mocked(GetImportsForGuild).mockReturnValue(new Map([[importID, { id: importID, type: SNAPSHOT_TYPE.IMPORT }] as never]));

		const plan = {
			snapshot_id: importID,
			guild_id: String(guildID),
			mask: RESTORE_OPTIONS.ROLES,
			actions: [{
				category: RESTORE_OPTIONS.ROLES,
				change_type: DIFF_CHANGE_TYPE.UPDATE,
				target_id: 100n,
				label: '@Mod',
				payload: { id: 100n, name: 'Mod', color: 0, hoist: 0, position: 1, permissions: 8n, managed_by: null }
			}],
			warnings: [],
			fingerprint: 'fingerprint-a',
			created_at: 0
		};
		BuildRestorePlan.mockResolvedValue(plan);
		GetCachedPlan.mockReturnValue(plan);

		const interaction = makeInteraction();
		await RestoreStart.execute(interaction, {} as IClient, [importID, String(RESTORE_OPTIONS.ROLES)]);

		const rows = await Database.query('SELECT id FROM SnapshotRestores WHERE guild_id = ?', [guildID]) as { id: number }[];
		expect(rows).toHaveLength(1);
		const persisted = await GetRestoreRun(rows[0].id);
		expect(persisted!.snapshot_id).toBeNull();
		expect(persisted!.import_id).toBe(importID);

		vi.mocked(GetImportsForGuild).mockReset().mockReturnValue(new Map());
	});
});
