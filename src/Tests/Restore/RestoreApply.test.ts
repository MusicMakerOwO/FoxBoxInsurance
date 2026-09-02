import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DiscordAPIError } from 'discord.js';
import { DIFF_CHANGE_TYPE, RESTORE_OPTIONS, RESTORE_RESULT, RESTORE_STATUS } from '../../Utils/Constants.js';
import { SnapshotChannel, SnapshotRestoreAction, SnapshotRole } from '../../Typings/DatabaseTypes.js';
import {
	BOT_USER_ID,
	GUILD_ID,
	RESTORE_NOW as NOW,
	ResetActionSeq,
	makeApplyGuild,
	restoreAction as action,
	restoreRecord as record
} from './Fixtures.js';

/**
 * The apply path - `Apply{Role,Channel,Ban}Action`, `BuildOverwrites` and the `ExecuteRun` loop that
 * drives them. Checklist sections 5 (ID remap) and 10 (apply semantics).
 *
 * Everything here is `unit+mock`: the guild is a stub whose every mutation is a spy, so a test that
 * "passes" without the call reaching Discord is impossible to write by accident.
 */

vi.mock('../../Client.js', () => ({
	client: { user: { id: BOT_USER_ID }, channels: { cache: new Map() }, guilds: { cache: new Map() } }
}));

// Mocked so a stray DB call is a loud failure rather than a hang. `FinishRestoreRun` and `GetGuild`
// are `.catch()`ed at their call sites, so they have to resolve rather than return undefined.
const { CRUD } = vi.hoisted(() => ({
	CRUD: {
		FinishRestoreRun             : vi.fn().mockResolvedValue(undefined),
		GetRestoreActions            : vi.fn(),
		GetRestoreRun                : vi.fn(),
		ListRunningRestores          : vi.fn(),
		MarkRunningRestoresInterrupted: vi.fn(),
		RecordActionResult           : vi.fn().mockResolvedValue(undefined),
		SkipRestoreActions           : vi.fn().mockResolvedValue(undefined)
	}
}));
vi.mock('../../CRUD/SnapshotRestores.js', () => CRUD);

const { GetGuild, SaveGuild } = vi.hoisted(() => ({
	GetGuild : vi.fn().mockResolvedValue(null),
	SaveGuild: vi.fn().mockResolvedValue(undefined)
}));
vi.mock('../../CRUD/Guilds.js', () => ({ GetGuild, SaveGuild }));

vi.mock('../../Utils/Log.js', async (importOriginal) => ({
	...(await importOriginal<typeof import('../../Utils/Log.js')>()),
	Log: vi.fn()
}));

const {
	ApplyBanAction, ApplyChannelAction, ApplyRoleAction, BuildOverwrites, BuildRun, ExecuteRun
} = await import('../../Services/RestoreRunner.js');

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(NOW);
	ResetActionSeq();
	vi.clearAllMocks();

	CRUD.FinishRestoreRun.mockResolvedValue(undefined);
	CRUD.RecordActionResult.mockResolvedValue(undefined);
	GetGuild.mockResolvedValue(null);
});

afterEach(() => {
	vi.useRealTimers();
});

//////////////////
// Fixtures
//////////////////

const REASON = 'Restore of Snapshot #142 by admin#0001 (20)';

type RolePayload    = Omit<SnapshotRole   , 'snapshot_id' | 'deleted'>;
type ChannelPayload = Omit<SnapshotChannel, 'snapshot_id' | 'deleted'>;

function rolePayload(id: bigint, overrides: Partial<RolePayload> = {}): RolePayload {
	return { id, name: 'Mod', color: 0, hoist: 0, position: 3, permissions: 8n, managed_by: null, ...overrides };
}

function channelPayload(id: bigint, overrides: Partial<ChannelPayload> = {}): ChannelPayload {
	return {
		id,
		name                 : 'general',
		type                 : 0,
		position             : 2,
		topic                : null,
		nsfw                 : 0,
		parent_id            : null,
		permission_overwrites: {},
		...overrides
	};
}

/** The `permission_overwrites` shape as it comes back out of the JSON column - allow/deny are strings */
function overwrite(allow = '0', deny = '0', type: 0 | 1 = 0) {
	return { allow, deny, type } as ChannelPayload['permission_overwrites'][string];
}

function roleAction(targetID: bigint, changeType: number, payload: RolePayload | null): SnapshotRestoreAction {
	return action({
		category   : RESTORE_OPTIONS.ROLES,
		change_type: changeType as SnapshotRestoreAction['change_type'],
		target_id  : targetID,
		payload
	});
}

function channelAction(targetID: bigint, changeType: number, payload: ChannelPayload | null): SnapshotRestoreAction {
	return action({
		category   : RESTORE_OPTIONS.CHANNELS,
		change_type: changeType as SnapshotRestoreAction['change_type'],
		target_id  : targetID,
		payload
	});
}

function banAction(targetID: bigint, changeType: number): SnapshotRestoreAction {
	return action({
		category   : RESTORE_OPTIONS.BANS,
		change_type: changeType as SnapshotRestoreAction['change_type'],
		target_id  : targetID,
		payload    : changeType === DIFF_CHANGE_TYPE.DELETE ? null : { id: targetID, reason: 'raid' }
	});
}

/** The last object handed to a `create`/`edit` spy */
function lastCall(spy: { mock: { calls: unknown[][] } }): Record<string, unknown> {
	return spy.mock.calls.at(-1)![0] as Record<string, unknown>;
}

//////////////////
// Section 5 - ID remap
//////////////////

describe('ID remap - parents', () => {
	it('rewrites a child channel parent_id onto the snowflake its category was actually created with', async () => {
		const { guild, spies } = makeApplyGuild();
		const remap = new Map<bigint, bigint>();

		const category = await ApplyChannelAction(
			guild, channelAction(100n, DIFF_CHANGE_TYPE.CREATE, channelPayload(100n, { type: 4, name: 'Staff' })), remap, REASON
		);

		expect(category.result).toBe(RESTORE_RESULT.OK);
		const newCategoryID = String(category.newID);

		const child = await ApplyChannelAction(
			guild, channelAction(101n, DIFF_CHANGE_TYPE.CREATE, channelPayload(101n, { parent_id: 100n })), remap, REASON
		);

		expect(child.result).toBe(RESTORE_RESULT.OK);
		// Not `100` - the snapshot's category ID is dead the moment the category is recreated
		expect(lastCall(spies.channelsCreate).parent).toBe(newCategoryID);
		expect(newCategoryID).not.toBe('100');
	});

	it('skips a CREATE whose category was never created rather than writing it to the server root', async () => {
		// Bug #14: reporting OK here is unrecoverable - the row is not FAILED, so retry never revisits
		// it, and the channel silently sits outside its category
		const { guild, spies } = makeApplyGuild();

		const outcome = await ApplyChannelAction(
			guild, channelAction(101n, DIFF_CHANGE_TYPE.CREATE, channelPayload(101n, { parent_id: 100n })), new Map(), REASON
		);

		expect(outcome).toEqual({ result: RESTORE_RESULT.SKIPPED, error: 'parent category was not created' });
		expect(spies.channelsCreate).not.toHaveBeenCalled();
	});

	it('skips an UPDATE whose category was never created rather than re-parenting to the root', async () => {
		const { guild, channelCache } = makeApplyGuild({ channels: [101n] });

		const outcome = await ApplyChannelAction(
			guild, channelAction(101n, DIFF_CHANGE_TYPE.UPDATE, channelPayload(101n, { parent_id: 100n })), new Map(), REASON
		);

		expect(outcome).toEqual({ result: RESTORE_RESULT.SKIPPED, error: 'parent category was not created' });
		expect(channelCache.get('101')!.edit).not.toHaveBeenCalled();
	});

	it('reports a missing channel ahead of a missing parent when both are gone', async () => {
		// The channel itself is the more useful cause - the parent is irrelevant if there is nothing to edit
		const { guild } = makeApplyGuild();

		const outcome = await ApplyChannelAction(
			guild, channelAction(101n, DIFF_CHANGE_TYPE.UPDATE, channelPayload(101n, { parent_id: 100n })), new Map(), REASON
		);

		expect(outcome).toEqual({ result: RESTORE_RESULT.SKIPPED, error: 'channel no longer exists' });
	});

	it('edits a genuinely parentless channel to parent: null instead of skipping it', async () => {
		const { guild, channelCache } = makeApplyGuild({ channels: [101n] });

		const outcome = await ApplyChannelAction(
			guild, channelAction(101n, DIFF_CHANGE_TYPE.UPDATE, channelPayload(101n, { parent_id: null })), new Map(), REASON
		);

		expect(outcome.result).toBe(RESTORE_RESULT.OK);
		expect(lastCall(channelCache.get('101')!.edit).parent).toBe(null);
	});
});

describe('ID remap - permission overwrites', () => {
	it('rewrites an overwrite keyed on a role the run recreated', async () => {
		const { guild, spies } = makeApplyGuild();
		const remap = new Map<bigint, bigint>();

		const role = await ApplyRoleAction(guild, roleAction(500n, DIFF_CHANGE_TYPE.CREATE, rolePayload(500n)), remap, REASON);
		const newRoleID = String(role.newID);

		await ApplyChannelAction(
			guild,
			channelAction(101n, DIFF_CHANGE_TYPE.CREATE, channelPayload(101n, {
				permission_overwrites: { '500': overwrite('2048', '0', 0) }
			})),
			remap,
			REASON
		);

		expect(lastCall(spies.channelsCreate).permissionOverwrites)
			.toEqual([{ id: newRoleID, allow: 2048n, deny: 0n, type: 0 }]);
	});

	it('drops a role overwrite whose role is not in the cache', async () => {
		// Discord rejects the whole call for one unknown role ID, taking every other overwrite with it
		const { guild, spies } = makeApplyGuild({ roles: [{ id: 500n }] });

		await ApplyChannelAction(
			guild,
			channelAction(101n, DIFF_CHANGE_TYPE.CREATE, channelPayload(101n, {
				permission_overwrites: { '500': overwrite('1', '0', 0), '777': overwrite('2', '0', 0) }
			})),
			new Map(),
			REASON
		);

		expect(lastCall(spies.channelsCreate).permissionOverwrites).toEqual([{ id: '500', allow: 1n, deny: 0n, type: 0 }]);
	});

	it('passes a user overwrite through even when the member is not cached', async () => {
		// The member cache is never complete enough to filter on, so user overwrites are never dropped
		const { guild, spies } = makeApplyGuild();

		await ApplyChannelAction(
			guild,
			channelAction(101n, DIFF_CHANGE_TYPE.CREATE, channelPayload(101n, {
				permission_overwrites: { '888': overwrite('0', '1024', 1) }
			})),
			new Map(),
			REASON
		);

		expect(lastCall(spies.channelsCreate).permissionOverwrites).toEqual([{ id: '888', allow: 0n, deny: 1024n, type: 1 }]);
	});

	it('parses allow/deny back to bigint from the strings the JSON column stores', async () => {
		const { guild } = makeApplyGuild({ roles: [{ id: 500n }] });

		const built = BuildOverwrites(guild, new Map(), {
			'500': overwrite('137411140161600', '2251799813685248', 0)
		});

		expect(built).toEqual([{ id: '500', allow: 137411140161600n, deny: 2251799813685248n, type: 0 }]);
	});

	it('remaps the overwrite key before the cache lookup, not after', async () => {
		// A recreated role is only ever in the cache under its *new* ID - looking the old one up first
		// would drop every overwrite the run just recreated
		const { guild } = makeApplyGuild({ roles: [{ id: 900_000n }] });

		expect(BuildOverwrites(guild, new Map([[500n, 900_000n]]), { '500': overwrite('4', '0', 0) }))
			.toEqual([{ id: '900000', allow: 4n, deny: 0n, type: 0 }]);
	});
});

//////////////////
// Section 10 - apply semantics
//////////////////

describe('ApplyRoleAction', () => {
	it('omits position on CREATE, since order is applied in one pass afterwards', async () => {
		const { guild, spies } = makeApplyGuild();

		const outcome = await ApplyRoleAction(guild, roleAction(500n, DIFF_CHANGE_TYPE.CREATE, rolePayload(500n, { position: 7 })), new Map(), REASON);

		expect(outcome.result).toBe(RESTORE_RESULT.OK);
		expect(lastCall(spies.rolesCreate)).not.toHaveProperty('position');
		expect(lastCall(spies.rolesCreate)).toMatchObject({ name: 'Mod', permissions: 8n, hoist: false, reason: REASON });
	});

	it('records the created snowflake in the remap and returns it', async () => {
		const { guild } = makeApplyGuild();
		const remap = new Map<bigint, bigint>();

		const outcome = await ApplyRoleAction(guild, roleAction(500n, DIFF_CHANGE_TYPE.CREATE, rolePayload(500n)), remap, REASON);

		expect(remap.get(500n)).toBe(outcome.newID);
		expect(typeof outcome.newID).toBe('bigint');
	});

	it('skips an UPDATE or DELETE of a role that no longer exists', async () => {
		const { guild } = makeApplyGuild();

		for (const changeType of [DIFF_CHANGE_TYPE.UPDATE, DIFF_CHANGE_TYPE.DELETE]) {
			expect(await ApplyRoleAction(guild, roleAction(500n, changeType, rolePayload(500n)), new Map(), REASON))
				.toEqual({ result: RESTORE_RESULT.SKIPPED, error: 'role no longer exists' });
		}
	});

	it('sends only permissions when updating @everyone', async () => {
		// Discord rejects a name, colour, hoist or position on @everyone - and permissions are the
		// entire reason it is in the plan
		const { guild, roleCache } = makeApplyGuild({ roles: [{ id: BigInt(GUILD_ID) }] });

		const outcome = await ApplyRoleAction(
			guild, roleAction(BigInt(GUILD_ID), DIFF_CHANGE_TYPE.UPDATE, rolePayload(BigInt(GUILD_ID), { permissions: 104324673n })), new Map(), REASON
		);

		expect(outcome.result).toBe(RESTORE_RESULT.OK);
		expect(lastCall(roleCache.get(GUILD_ID)!.edit)).toEqual({ permissions: 104324673n, reason: REASON });
	});

	it('sends the full field set when updating an ordinary role', async () => {
		const { guild, roleCache } = makeApplyGuild({ roles: [{ id: 500n }] });

		await ApplyRoleAction(guild, roleAction(500n, DIFF_CHANGE_TYPE.UPDATE, rolePayload(500n, { hoist: 1, color: 42 })), new Map(), REASON);

		expect(lastCall(roleCache.get('500')!.edit)).toEqual({
			name: 'Mod', color: 42, hoist: true, permissions: 8n, reason: REASON
		});
	});

	it('deletes with the audit reason', async () => {
		const { guild, roleCache } = makeApplyGuild({ roles: [{ id: 500n }] });

		const outcome = await ApplyRoleAction(guild, roleAction(500n, DIFF_CHANGE_TYPE.DELETE, null), new Map(), REASON);

		expect(outcome).toEqual({ result: RESTORE_RESULT.OK });
		expect(roleCache.get('500')!.delete).toHaveBeenCalledWith(REASON);
	});
});

describe('ApplyChannelAction', () => {
	it('omits topic and nsfw unless the payload carries them, so a category is not rejected', async () => {
		const { guild, spies } = makeApplyGuild();

		await ApplyChannelAction(
			guild, channelAction(100n, DIFF_CHANGE_TYPE.CREATE, channelPayload(100n, { type: 4, name: 'Staff' })), new Map(), REASON
		);

		expect(lastCall(spies.channelsCreate)).not.toHaveProperty('topic');
		expect(lastCall(spies.channelsCreate)).not.toHaveProperty('nsfw');
		expect(lastCall(spies.channelsCreate)).not.toHaveProperty('parent');
		expect(lastCall(spies.channelsCreate)).toMatchObject({ name: 'Staff', type: 4, position: 2, reason: REASON });
	});

	it('includes topic and nsfw when the payload does carry them', async () => {
		const { guild, spies } = makeApplyGuild();

		await ApplyChannelAction(
			guild, channelAction(101n, DIFF_CHANGE_TYPE.CREATE, channelPayload(101n, { topic: 'rules go here', nsfw: 1 })), new Map(), REASON
		);

		expect(lastCall(spies.channelsCreate)).toMatchObject({ topic: 'rules go here', nsfw: true });
	});

	it('skips an UPDATE or DELETE of a channel that no longer exists', async () => {
		const { guild } = makeApplyGuild();

		expect(await ApplyChannelAction(guild, channelAction(101n, DIFF_CHANGE_TYPE.DELETE, null), new Map(), REASON))
			.toEqual({ result: RESTORE_RESULT.SKIPPED, error: 'channel no longer exists' });
		expect(await ApplyChannelAction(guild, channelAction(101n, DIFF_CHANGE_TYPE.UPDATE, channelPayload(101n)), new Map(), REASON))
			.toEqual({ result: RESTORE_RESULT.SKIPPED, error: 'channel no longer exists' });
	});

	it('deletes an existing channel with the audit reason', async () => {
		const { guild, channelCache } = makeApplyGuild({ channels: [101n] });

		const outcome = await ApplyChannelAction(guild, channelAction(101n, DIFF_CHANGE_TYPE.DELETE, null), new Map(), REASON);

		expect(outcome).toEqual({ result: RESTORE_RESULT.OK });
		expect(channelCache.get('101')!.delete).toHaveBeenCalledWith(REASON);
	});
});

describe('ApplyBanAction', () => {
	/** A real `DiscordAPIError`, since the 10026 branch is an `instanceof` check */
	function apiError(code: number, message: string) {
		return new DiscordAPIError({ code, message }, code, 404, 'DELETE', 'https://discord.test', {});
	}

	it('bans with the audit reason', async () => {
		const { guild, spies } = makeApplyGuild();

		const outcome = await ApplyBanAction(guild, banAction(700n, DIFF_CHANGE_TYPE.CREATE), REASON);

		expect(outcome).toEqual({ result: RESTORE_RESULT.OK });
		expect(spies.bansCreate).toHaveBeenCalledWith('700', { reason: REASON });
	});

	it('is idempotent about a user who is already banned', async () => {
		// Discord accepts a repeat ban, so the planner never needs to check first
		const { guild, spies } = makeApplyGuild();

		await ApplyBanAction(guild, banAction(700n, DIFF_CHANGE_TYPE.CREATE), REASON);
		const second = await ApplyBanAction(guild, banAction(700n, DIFF_CHANGE_TYPE.CREATE), REASON);

		expect(second).toEqual({ result: RESTORE_RESULT.OK });
		expect(spies.bansCreate).toHaveBeenCalledTimes(2);
	});

	it('skips an unban of someone already unbanned rather than failing it', async () => {
		// A FAILED row here could never be cleared by a retry - the end state is already correct
		const { guild, spies } = makeApplyGuild();
		spies.bansRemove.mockRejectedValueOnce(apiError(10026, 'Unknown Ban'));

		expect(await ApplyBanAction(guild, banAction(700n, DIFF_CHANGE_TYPE.DELETE), REASON))
			.toEqual({ result: RESTORE_RESULT.SKIPPED, error: 'user is not banned' });
	});

	it('rethrows any other API error from an unban', async () => {
		const { guild, spies } = makeApplyGuild();
		spies.bansRemove.mockRejectedValueOnce(apiError(50013, 'Missing Permissions'));

		await expect(ApplyBanAction(guild, banAction(700n, DIFF_CHANGE_TYPE.DELETE), REASON))
			.rejects.toThrow('Missing Permissions');
	});

	it('rethrows a plain Error from an unban', async () => {
		const { guild, spies } = makeApplyGuild();
		spies.bansRemove.mockRejectedValueOnce(new Error('socket hang up'));

		await expect(ApplyBanAction(guild, banAction(700n, DIFF_CHANGE_TYPE.DELETE), REASON))
			.rejects.toThrow('socket hang up');
	});
});

//////////////////
// Section 10 - the ExecuteRun loop
//////////////////

describe('ExecuteRun', () => {
	function execute(guild: Parameters<typeof ExecuteRun>[0], actions: SnapshotRestoreAction[], options: {
		toApply?: SnapshotRestoreAction[],
		isRetry?: boolean,
		record?: Parameters<typeof record>[0]
	} = {}) {
		const row = record({ guild_id: BigInt(GUILD_ID), message_id: null, ...options.record });
		const run = BuildRun(row, actions, 'admin#0001', Promise.resolve());

		return ExecuteRun(guild, row, run, options.toApply ?? actions, actions, options.isRetry ?? false)
			.then(() => run);
	}

	it('stamps every mutation with an audit reason naming the source, the admin and their ID', async () => {
		const { guild, spies, roleCache, channelCache } = makeApplyGuild({ roles: [{ id: 501n }], channels: [102n] });

		await execute(guild, [
			roleAction(500n, DIFF_CHANGE_TYPE.CREATE, rolePayload(500n)),
			roleAction(501n, DIFF_CHANGE_TYPE.DELETE, null),
			channelAction(101n, DIFF_CHANGE_TYPE.CREATE, channelPayload(101n)),
			channelAction(102n, DIFF_CHANGE_TYPE.DELETE, null),
			banAction(700n, DIFF_CHANGE_TYPE.CREATE)
		]);

		const expected = 'Restore of Snapshot #142 by admin#0001 (20)';

		expect(lastCall(spies.rolesCreate).reason).toBe(expected);
		expect(roleCache.get('501')!.delete).toHaveBeenCalledWith(expected);
		expect(lastCall(spies.channelsCreate).reason).toBe(expected);
		expect(channelCache.get('102')!.delete).toHaveBeenCalledWith(expected);
		expect(spies.bansCreate).toHaveBeenCalledWith('700', { reason: expected });
	});

	it('truncates the audit reason at 500 characters', async () => {
		// Discord rejects a longer X-Audit-Log-Reason outright, which would fail every action
		const { guild, spies } = makeApplyGuild();

		await execute(guild, [roleAction(500n, DIFF_CHANGE_TYPE.CREATE, rolePayload(500n))], {
			record: { import_id: 'X'.repeat(600), snapshot_id: null }
		});

		expect((lastCall(spies.rolesCreate).reason as string).length).toBe(500);
	});

	it('records a failure and keeps going rather than abandoning the rest of the run', async () => {
		// One role above the bot must not cost the admin the other hundred actions they confirmed
		const { guild, spies } = makeApplyGuild();
		spies.rolesCreate.mockRejectedValueOnce(new Error('Missing Permissions'));

		const actions = [
			roleAction(500n, DIFF_CHANGE_TYPE.CREATE, rolePayload(500n)),
			roleAction(501n, DIFF_CHANGE_TYPE.CREATE, rolePayload(501n)),
			banAction(700n, DIFF_CHANGE_TYPE.CREATE)
		];

		const run = await execute(guild, actions);

		expect(actions[0]!.result).toBe(RESTORE_RESULT.FAILED);
		expect(actions[0]!.error).toBe('Missing Permissions');
		expect(actions[1]!.result).toBe(RESTORE_RESULT.OK);
		expect(actions[2]!.result).toBe(RESTORE_RESULT.OK);
		expect(run).toMatchObject({ total: 3, applied: 2, failed: 1, skipped: 0 });
		expect(CRUD.FinishRestoreRun).toHaveBeenCalledWith(1, RESTORE_STATUS.FAILED, 2);
	});

	it('persists each outcome as it happens, including the created snowflake', async () => {
		const { guild } = makeApplyGuild();
		const actions = [roleAction(500n, DIFF_CHANGE_TYPE.CREATE, rolePayload(500n))];

		await execute(guild, actions);

		expect(CRUD.RecordActionResult).toHaveBeenCalledWith(1, actions[0]!.seq, RESTORE_RESULT.OK, actions[0]!.new_id, null);
		expect(actions[0]!.new_id).not.toBe(null);
	});

	it('reorders roles at the first non-role action, before anything references them', async () => {
		const { guild, spies } = makeApplyGuild({ botHighestPosition: 100 });

		await execute(guild, [
			roleAction(500n, DIFF_CHANGE_TYPE.CREATE, rolePayload(500n, { position: 5 })),
			channelAction(101n, DIFF_CHANGE_TYPE.CREATE, channelPayload(101n))
		]);

		expect(spies.setPositions).toHaveBeenCalledTimes(1);
		expect(spies.setPositions.mock.invocationCallOrder[0]!)
			.toBeLessThan(spies.channelsCreate.mock.invocationCallOrder[0]!);
	});

	it('reorders before role deletes run, which `ActionRank` puts last', async () => {
		// Documenting the interaction rather than complaining about it: role DELETE is rank 9 and the
		// first category CREATE is rank 2, so `setPositions` lands while roles the plan is about to
		// delete still exist. That is fine - deleting a role shifts everything below it down
		// uniformly, so relative order survives, and the absolute indices were never meaningful
		// (snapshot positions are indices into a different role list). Change this and re-read that
		// reasoning first.
		const { guild, spies, roleCache } = makeApplyGuild({ roles: [{ id: 501n }] });

		await execute(guild, [
			roleAction(500n, DIFF_CHANGE_TYPE.CREATE, rolePayload(500n, { position: 5 })),
			channelAction(101n, DIFF_CHANGE_TYPE.CREATE, channelPayload(101n)),
			roleAction(501n, DIFF_CHANGE_TYPE.DELETE, null)
		]);

		expect(spies.setPositions.mock.invocationCallOrder[0]!)
			.toBeLessThan(roleCache.get('501')!.delete.mock.invocationCallOrder[0]!);
	});

	it('runs no reorder call at all for a plan holding no roles', async () => {
		// A bans-only plan still enters the reposition pass at its first action; it finds no role
		// actions to move and never reaches Discord
		const { guild, spies } = makeApplyGuild();

		await execute(guild, [banAction(700n, DIFF_CHANGE_TYPE.CREATE)]);

		expect(spies.setPositions).not.toHaveBeenCalled();
		expect(spies.bansCreate).toHaveBeenCalledTimes(1);
	});

	it('still reorders after the loop when every action was a role', async () => {
		// The in-loop trigger never fires on an all-roles run, so the trailing pass is the only one
		const { guild, spies } = makeApplyGuild();

		await execute(guild, [
			roleAction(500n, DIFF_CHANGE_TYPE.CREATE, rolePayload(500n, { position: 5 })),
			roleAction(501n, DIFF_CHANGE_TYPE.CREATE, rolePayload(501n, { position: 6 }))
		]);

		expect(spies.setPositions).toHaveBeenCalledTimes(1);
		expect(spies.setPositions.mock.calls[0]![0]).toHaveLength(2);
	});

	it('skips the reorder pass on a retry that touches no roles', async () => {
		// The original run already ordered them, and repeating the pass would undo whatever an admin
		// fixed by hand in between.
		// The recreated role has to be in the cache: if it were not, the reposition pass would find
		// nothing to move and this would pass whether or not the pass ran at all
		const { guild, spies } = makeApplyGuild({ roles: [{ id: 900_000n }] });

		const roleRow = roleAction(500n, DIFF_CHANGE_TYPE.CREATE, rolePayload(500n, { position: 5 }));
		roleRow.result = RESTORE_RESULT.OK;
		roleRow.new_id = 900_000n;

		const channelRow = channelAction(101n, DIFF_CHANGE_TYPE.CREATE, channelPayload(101n));
		channelRow.result = RESTORE_RESULT.FAILED;

		await execute(guild, [roleRow, channelRow], { toApply: [channelRow], isRetry: true });

		expect(spies.setPositions).not.toHaveBeenCalled();
		expect(spies.channelsCreate).toHaveBeenCalledTimes(1);
	});

	it('re-parents a retried channel through the remap rehydrated from new_id', async () => {
		// The retry starts with an empty remap, so without `new_id` the child would be sent the dead
		// snapshot ID of a category the original run already recreated
		const { guild, spies } = makeApplyGuild({ channels: [900_500n] });

		const categoryRow = channelAction(100n, DIFF_CHANGE_TYPE.CREATE, channelPayload(100n, { type: 4 }));
		categoryRow.result = RESTORE_RESULT.OK;
		categoryRow.new_id = 900_500n;

		const childRow = channelAction(101n, DIFF_CHANGE_TYPE.CREATE, channelPayload(101n, { parent_id: 100n }));
		childRow.result = RESTORE_RESULT.FAILED;

		await execute(guild, [categoryRow, childRow], { toApply: [childRow], isRetry: true });

		expect(lastCall(spies.channelsCreate).parent).toBe('900500');
		expect(childRow.result).toBe(RESTORE_RESULT.OK);
	});

	it('marks the remainder skipped once a stop is requested, and finishes STOPPED', async () => {
		const { guild, spies } = makeApplyGuild();
		const actions = [
			roleAction(500n, DIFF_CHANGE_TYPE.CREATE, rolePayload(500n)),
			roleAction(501n, DIFF_CHANGE_TYPE.CREATE, rolePayload(501n))
		];

		const row = record({ guild_id: BigInt(GUILD_ID), message_id: null });
		const run = BuildRun(row, actions, 'admin#0001', Promise.resolve());
		run.stop_requested = true;

		await ExecuteRun(guild, row, run, actions, actions, false);

		expect(spies.rolesCreate).not.toHaveBeenCalled();
		expect(spies.setPositions).not.toHaveBeenCalled();
		expect(actions.map(a => a.result)).toEqual([RESTORE_RESULT.SKIPPED, RESTORE_RESULT.SKIPPED]);
		expect(actions[0]!.error).toBe('stopped before this action ran');
		expect(run).toMatchObject({ applied: 0, failed: 0, skipped: 2 });
		expect(CRUD.FinishRestoreRun).toHaveBeenCalledWith(1, RESTORE_STATUS.STOPPED, 0);
	});

	it('records last_restore only when something was actually applied', async () => {
		const { guild, spies } = makeApplyGuild();
		const savedGuild = { id: GUILD_ID, last_restore: null };
		GetGuild.mockResolvedValue(savedGuild);

		await execute(guild, [roleAction(500n, DIFF_CHANGE_TYPE.CREATE, rolePayload(500n))]);
		expect(SaveGuild).toHaveBeenCalledTimes(1);
		expect(savedGuild.last_restore).toBe(BigInt(NOW));

		vi.clearAllMocks();
		GetGuild.mockResolvedValue(savedGuild);
		CRUD.FinishRestoreRun.mockResolvedValue(undefined);
		CRUD.RecordActionResult.mockResolvedValue(undefined);

		spies.rolesCreate.mockRejectedValueOnce(new Error('Missing Permissions'));
		await execute(guild, [roleAction(501n, DIFF_CHANGE_TYPE.CREATE, rolePayload(501n))]);
		expect(SaveGuild).not.toHaveBeenCalled();
	});
});
