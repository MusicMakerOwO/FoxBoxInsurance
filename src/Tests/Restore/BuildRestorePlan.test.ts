import { describe, it, expect, vi, afterEach } from 'vitest';
import { ChannelType } from 'discord.js';
import { DIFF_CHANGE_TYPE, RESTORE_OPTIONS, RESTORE_PRESETS } from '../../Utils/Constants.js';
import { DiscordPermissions } from '../../Utils/DiscordConstants.js';
import {
	BOT_ROLE, BOT_USER_ID, EVERYONE, GUILD_ID,
	ChannelFixture,
	ban, channel, emptySnapshot, makeGuild, makeJSONSnapshot, makeSnapshot, overwrite, role
} from './Fixtures.js';

// `MoveBotRoleToTop` resolves the bot role through `client.user.id`, and throws if neither side has
// one - so every fixture below carries a role owned by this ID
vi.mock('../../Client.js', () => ({ client: { user: { id: BOT_USER_ID } } }));

// `Log` writes nothing at all under vitest (`SUPPRESS_LOGS`), so a console spy would never see the
// error report Bug #9 added - the call itself has to be the observable
const { LogSpy } = vi.hoisted(() => ({ LogSpy: vi.fn() }));
vi.mock('../../Utils/Log.js', async (importOriginal) => ({
	...(await importOriginal<typeof import('../../Utils/Log.js')>()),
	Log: LogSpy
}));

const { BuildRestorePlan, InvalidateRestorePlans, RestorePlanError } = await import('../../Services/RestorePlans.js');

/** `Array.prototype.sort` is lexicographic by default, which orders `10n` ahead of `2n` */
function sorted(ids: bigint[]): bigint[] {
	return [...ids].sort((a, b) => Number(a - b));
}

afterEach(() => {
	InvalidateRestorePlans(GUILD_ID);
	LogSpy.mockClear();
});

const GENERAL = channel(10n, 'general', ChannelType.GuildText, null);
const MOD = role(2n, 'Mod');

describe('BuildRestorePlan - mask scoping', () => {
	// One fixture that produces role, channel and ban actions at once, so each mask below is a
	// filter over a known-non-empty superset rather than an empty plan that passes vacuously
	function everything(id: number) {
		return {
			guild   : makeGuild([BOT_ROLE, EVERYONE, MOD], [GENERAL], { bans: [ban(70n)] }),
			snapshot: emptySnapshot(id)
		};
	}

	it('yields only role actions for mask=ROLES', async () => {
		const { guild, snapshot } = everything(100);
		const plan = await BuildRestorePlan(guild, snapshot, RESTORE_OPTIONS.ROLES);

		expect(plan.actions.length).toBeGreaterThan(0);
		expect(plan.actions.every(a => a.category === RESTORE_OPTIONS.ROLES)).toBe(true);
	});

	it('drops roles for mask=CHANNELS|BANS', async () => {
		const { guild, snapshot } = everything(101);
		const plan = await BuildRestorePlan(guild, snapshot, RESTORE_OPTIONS.CHANNELS | RESTORE_OPTIONS.BANS);

		expect(plan.actions.some(a => a.category === RESTORE_OPTIONS.CHANNELS)).toBe(true);
		expect(plan.actions.some(a => a.category === RESTORE_OPTIONS.BANS)).toBe(true);
		expect(plan.actions.some(a => a.category === RESTORE_OPTIONS.ROLES)).toBe(false);
	});

	it('yields an empty plan for mask=0', async () => {
		const { guild, snapshot } = everything(102);
		const plan = await BuildRestorePlan(guild, snapshot, 0);

		expect(plan.actions).toHaveLength(0);
		expect(plan.mask).toBe(0);
	});

	it('yields nothing for mask=MESSAGES, which is unimplemented', async () => {
		// The toggle is rendered permanently disabled, but a hand-crafted custom_id could still set
		// bit 8 - it must not fall through to some other category
		const { guild, snapshot } = everything(103);
		const plan = await BuildRestorePlan(guild, snapshot, RESTORE_OPTIONS.MESSAGES);

		expect(plan.actions).toHaveLength(0);
	});
});

describe('BuildRestorePlan - boundaries', () => {
	it('yields nothing when the guild already matches the snapshot', async () => {
		const guild = makeGuild([BOT_ROLE, EVERYONE, MOD], [GENERAL], { bans: [ban(70n)] });
		const snapshot = makeSnapshot(110, [BOT_ROLE, EVERYONE, MOD], [GENERAL], [ban(70n)]);

		const plan = await BuildRestorePlan(guild, snapshot, RESTORE_PRESETS.FULL);

		expect(plan.actions).toHaveLength(0);
		expect(plan.warnings).toHaveLength(0);
	});

	it('turns every live entity into a DELETE against an empty snapshot', async () => {
		const guild = makeGuild([BOT_ROLE, EVERYONE, MOD, role(3n, 'Helper')], [GENERAL], { bans: [ban(70n)] });

		const plan = await BuildRestorePlan(guild, emptySnapshot(111), RESTORE_PRESETS.FULL);

		expect(plan.actions.every(a => a.change_type === DIFF_CHANGE_TYPE.DELETE)).toBe(true);
		// Two roles, one channel, one ban - `@everyone` and the bot role are filtered out
		expect(sorted(plan.actions.map(a => a.target_id))).toEqual([2n, 3n, 10n, 70n]);
	});

	it('turns every snapshot entity into a CREATE against an empty guild', async () => {
		const guild = makeGuild([BOT_ROLE, EVERYONE], []);
		const snapshot = makeSnapshot(112, [BOT_ROLE, EVERYONE, MOD], [GENERAL], [ban(70n)]);

		const plan = await BuildRestorePlan(guild, snapshot, RESTORE_PRESETS.FULL);

		expect(plan.actions.every(a => a.change_type === DIFF_CHANGE_TYPE.CREATE)).toBe(true);
		expect(sorted(plan.actions.map(a => a.target_id))).toEqual([2n, 10n, 70n]);
	});

	it('does not throw when both sides are completely empty', async () => {
		// No roles at all on either side means no bot role either - `MoveBotRoleToTop` has to take
		// its `roles.length >= 1` early return rather than the throw
		const plan = await BuildRestorePlan(makeGuild([], []), makeSnapshot(113, [], []), RESTORE_PRESETS.FULL);

		expect(plan.actions).toHaveLength(0);
	});
});

describe('BuildRestorePlan - role filtering', () => {
	it('drops roles the snapshot marks as managed', async () => {
		// An integration role: recorded in the snapshot, but the API rejects every write to it
		const integration = role(3n, 'Server Booster', { managed_by: 1234n });
		const guild = makeGuild([BOT_ROLE, EVERYONE, MOD], []);
		const snapshot = makeSnapshot(120, [BOT_ROLE, EVERYONE, MOD, integration], []);

		const plan = await BuildRestorePlan(guild, snapshot, RESTORE_OPTIONS.ROLES);

		expect(plan.actions).toHaveLength(0);
	});

	it('falls back to the live managed flag for roles the snapshot does not mark', async () => {
		// The booster role carries no `managed_by` in older snapshot rows, so the only signal is
		// discord.js's `Role.managed` on the live side
		const booster = role(3n, 'Server Booster', { managed: true });
		const guild = makeGuild([BOT_ROLE, EVERYONE, MOD, booster], []);

		const plan = await BuildRestorePlan(guild, emptySnapshot(121), RESTORE_OPTIONS.ROLES);

		expect(plan.actions.map(a => a.target_id)).toEqual([2n]);
	});

	it("drops the bot's own role", async () => {
		// Renamed since the snapshot was taken, so the diff genuinely wants to update it - editing
		// the role the run depends on mid-run is exactly what must not happen
		const guild = makeGuild([role(BOT_ROLE.id, 'FBI (renamed)', { managed_by: BOT_ROLE.managed_by, position: 50 }), EVERYONE, MOD], []);

		const plan = await BuildRestorePlan(guild, makeSnapshot(122, [BOT_ROLE, EVERYONE, MOD], []), RESTORE_OPTIONS.ROLES);

		expect(plan.actions.some(a => a.target_id === BOT_ROLE.id)).toBe(false);
	});
});

describe('BuildRestorePlan - @everyone (Bug #5)', () => {
	it('renders a permissions drift as a single UPDATE', async () => {
		const guild = makeGuild([BOT_ROLE, EVERYONE], []);
		const snapshot = makeSnapshot(130, [BOT_ROLE, role(BigInt(GUILD_ID), '@everyone', { permissions: 8n })], []);

		const plan = await BuildRestorePlan(guild, snapshot, RESTORE_OPTIONS.ROLES);

		expect(plan.actions).toHaveLength(1);
		expect(plan.actions[0].change_type).toBe(DIFF_CHANGE_TYPE.UPDATE);
		expect(plan.actions[0].target_id).toBe(BigInt(GUILD_ID));
	});

	it("re-keys a cross-guild import's @everyone and its channel overwrites onto the live guild", async () => {
		const SOURCE_GUILD = 777n;
		// An import from another server: its `@everyone` is keyed on *that* server's snowflake, and
		// so is every overwrite referencing it. Left alone the diff would emit a DELETE of this
		// server's `@everyone` plus a CREATE that Discord rejects
		const imported = makeJSONSnapshot(
			'ABCD-1234',
			[BOT_ROLE, role(SOURCE_GUILD, '@everyone', { permissions: 8n })],
			[channel(10n, 'general', ChannelType.GuildText, null, {
				permission_overwrites: { [SOURCE_GUILD.toString()]: overwrite('1024', '0') }
			})]
		);
		const guild = makeGuild([BOT_ROLE, EVERYONE], [GENERAL]);

		const plan = await BuildRestorePlan(guild, imported, RESTORE_PRESETS.FULL);

		const everyoneActions = plan.actions.filter(a => a.category === RESTORE_OPTIONS.ROLES);
		expect(everyoneActions).toHaveLength(1);
		expect(everyoneActions[0].change_type).toBe(DIFF_CHANGE_TYPE.UPDATE);
		expect(everyoneActions[0].target_id).toBe(BigInt(GUILD_ID));

		// ...and the overwrite followed it, or `ApplyChannelAction` would drop it as an unknown role
		const channelAction = plan.actions.find(a => a.category === RESTORE_OPTIONS.CHANNELS);
		const overwrites = (channelAction?.payload as ChannelFixture).permission_overwrites;
		expect(Object.keys(overwrites)).toEqual([GUILD_ID]);
		expect(overwrites[GUILD_ID].allow).toBe('1024');
	});

	it('does not delete the live @everyone when the snapshot holds none', async () => {
		const guild = makeGuild([BOT_ROLE, EVERYONE, MOD], []);
		const snapshot = makeSnapshot(131, [BOT_ROLE], []);

		const plan = await BuildRestorePlan(guild, snapshot, RESTORE_OPTIONS.ROLES);

		expect(plan.actions.map(a => a.target_id)).toEqual([2n]);
	});

	it('leaves the cached snapshot untouched across repeated builds', async () => {
		// `GetSnapshot` hands out the same object from its LRU cache on every preview click, and
		// `CreateSnapshotDiff` mutates role positions in place - so a missing deep copy would show up
		// as the second preview differing from the first
		const topRole = role(3n, 'Owner', { position: 60 });
		const snapshot = makeSnapshot(132, [BOT_ROLE, EVERYONE, topRole], []);
		const guild = makeGuild([BOT_ROLE, EVERYONE], []);

		const first = await BuildRestorePlan(guild, snapshot, RESTORE_PRESETS.FULL);
		InvalidateRestorePlans(GUILD_ID);
		const second = await BuildRestorePlan(guild, snapshot, RESTORE_PRESETS.FULL);

		expect(snapshot.roles.get(BOT_ROLE.id)!.position).toBe(50);
		expect(snapshot.roles.get(BigInt(GUILD_ID))!.id).toBe(BigInt(GUILD_ID));
		expect(second.fingerprint).toBe(first.fingerprint);
		expect(second.actions.map(a => a.payload)).toEqual(first.actions.map(a => a.payload));
	});
});

describe('BuildRestorePlan - bans', () => {
	it('discards reason-only drift', async () => {
		// Discord has no edit-ban API, and restore cares that the user is banned, not why - counting
		// this would inflate the preview with an action the runner cannot perform
		const guild = makeGuild([BOT_ROLE, EVERYONE], [], { bans: [ban(70n, 'spam')] });
		const snapshot = makeSnapshot(140, [BOT_ROLE, EVERYONE], [], [ban(70n, 'raiding')]);

		const plan = await BuildRestorePlan(guild, snapshot, RESTORE_OPTIONS.BANS);

		expect(plan.actions).toHaveLength(0);
	});

	it('keeps ban creates and deletes', async () => {
		const guild = makeGuild([BOT_ROLE, EVERYONE], [], { bans: [ban(70n)] });
		const snapshot = makeSnapshot(141, [BOT_ROLE, EVERYONE], [], [ban(71n)]);

		const plan = await BuildRestorePlan(guild, snapshot, RESTORE_OPTIONS.BANS);

		expect(plan.actions).toHaveLength(2);
		expect(plan.actions.find(a => a.target_id === 71n)!.change_type).toBe(DIFF_CHANGE_TYPE.CREATE);
		expect(plan.actions.find(a => a.target_id === 70n)!.change_type).toBe(DIFF_CHANGE_TYPE.DELETE);
	});
});

describe('BuildRestorePlan - payloads and labels', () => {
	it('carries a null payload on DELETE and the snapshot entity on CREATE/UPDATE', async () => {
		// The payload is the desired end state, so it must come from the snapshot - taking it from
		// the live entity would make every UPDATE a no-op
		const guild = makeGuild([BOT_ROLE, EVERYONE, role(2n, 'Mod', { color: 0x000001 }), role(3n, 'Gone')], []);
		const snapshot = makeSnapshot(150, [BOT_ROLE, EVERYONE, role(2n, 'Mod', { color: 0x0000ff })], []);

		const plan = await BuildRestorePlan(guild, snapshot, RESTORE_OPTIONS.ROLES);

		const update = plan.actions.find(a => a.target_id === 2n)!;
		expect(update.change_type).toBe(DIFF_CHANGE_TYPE.UPDATE);
		expect(update.payload).toMatchObject({ id: 2n, name: 'Mod', color: 0x0000ff });

		const remove = plan.actions.find(a => a.target_id === 3n)!;
		expect(remove.change_type).toBe(DIFF_CHANGE_TYPE.DELETE);
		expect(remove.payload).toBeNull();
	});

	it('carries a null detail on CREATE/DELETE and a field summary on UPDATE', async () => {
		const guild = makeGuild([BOT_ROLE, EVERYONE, role(2n, 'Mod', { color: 0x000001, hoist: 0 }), role(3n, 'Gone')], []);
		const snapshot = makeSnapshot(152, [BOT_ROLE, EVERYONE, role(2n, 'Mod', { color: 0x0000ff, hoist: 1 }), role(4n, 'New')], []);

		const plan = await BuildRestorePlan(guild, snapshot, RESTORE_OPTIONS.ROLES);

		const update = plan.actions.find(a => a.target_id === 2n)!;
		expect(update.change_type).toBe(DIFF_CHANGE_TYPE.UPDATE);
		expect(update.detail).toBe('color, hoist');

		const remove = plan.actions.find(a => a.target_id === 3n)!;
		expect(remove.change_type).toBe(DIFF_CHANGE_TYPE.DELETE);
		expect(remove.detail).toBeNull();

		const create = plan.actions.find(a => a.target_id === 4n)!;
		expect(create.change_type).toBe(DIFF_CHANGE_TYPE.CREATE);
		expect(create.detail).toBeNull();
	});

	it('summarises a changed channel overwrite as a count in the detail', async () => {
		const guild = makeGuild([BOT_ROLE, EVERYONE], [
			channel(10n, 'general', ChannelType.GuildText, null, {
				permission_overwrites: { '2': overwrite('0', '0'), '3': overwrite('8', '0') }
			})
		]);
		const snapshot = makeSnapshot(153, [BOT_ROLE, EVERYONE], [
			channel(10n, 'general', ChannelType.GuildText, null, {
				topic: 'new topic',
				permission_overwrites: { '2': overwrite('8', '0'), '3': overwrite('8', '0') }
			})
		]);

		const plan = await BuildRestorePlan(guild, snapshot, RESTORE_OPTIONS.CHANNELS);

		const update = plan.actions.find(a => a.target_id === 10n)!;
		expect(update.change_type).toBe(DIFF_CHANGE_TYPE.UPDATE);
		expect(update.detail).toBe('topic, 1 overwrite');
	});

	it('labels roles, channels and bans in their mention forms', async () => {
		const guild = makeGuild([BOT_ROLE, EVERYONE, role(2n, '**Mod**')], [channel(10n, 'raid-log', ChannelType.GuildText, null)], { bans: [ban(70n)] });

		const plan = await BuildRestorePlan(guild, emptySnapshot(151), RESTORE_PRESETS.FULL);

		const label = (id: bigint) => plan.actions.find(a => a.target_id === id)!.label;
		// `RemoveFormatting` escapes the markers rather than deleting them, so a role literally named
		// `**Mod**` still reads as `**Mod**` in Discord instead of rendering bold
		expect(label(2n)).toBe('@\\*\\*Mod\\*\\*');
		expect(label(10n)).toBe('#raid-log');
		expect(label(70n)).toBe('<@70>');
	});
});

describe('BuildRestorePlan - warnings', () => {
	const NO_PERMISSIONS = { permissions: [] as bigint[] };

	it('warns once per missing permission, and only for masked-in categories', async () => {
		const guild = makeGuild([BOT_ROLE, EVERYONE, MOD], [GENERAL], NO_PERMISSIONS);

		const plan = await BuildRestorePlan(guild, emptySnapshot(160), RESTORE_PRESETS.FULL);

		expect(plan.warnings).toHaveLength(3);
		expect(plan.warnings.some(w => w.includes('Manage Channels'))).toBe(true);
		expect(plan.warnings.some(w => w.includes('Manage Roles'))).toBe(true);
		expect(plan.warnings.some(w => w.includes('Ban Members'))).toBe(true);
	});

	it('does not warn about Manage Channels when channels are not in the mask', async () => {
		const guild = makeGuild([BOT_ROLE, EVERYONE, MOD], [GENERAL], NO_PERMISSIONS);

		const plan = await BuildRestorePlan(guild, emptySnapshot(161), RESTORE_OPTIONS.ROLES);

		expect(plan.warnings).toEqual([expect.stringContaining('Manage Roles')]);
	});

	it('warns about each permission independently', async () => {
		// Holding two of the three must surface exactly the third
		const guild = makeGuild([BOT_ROLE, EVERYONE, MOD], [GENERAL], {
			permissions: [DiscordPermissions.ManageChannels, DiscordPermissions.ManageRoles]
		});

		const plan = await BuildRestorePlan(guild, emptySnapshot(162), RESTORE_PRESETS.FULL);

		expect(plan.warnings).toEqual([expect.stringContaining('Ban Members')]);
	});

	it('warns that an import may be cross-guild, but a stored snapshot does not', async () => {
		const guild = makeGuild([BOT_ROLE, EVERYONE, MOD], [GENERAL]);

		const importPlan = await BuildRestorePlan(guild, makeJSONSnapshot('abcd', [BOT_ROLE, EVERYONE], []), RESTORE_PRESETS.FULL);
		expect(importPlan.warnings.some(w => w.includes('import'))).toBe(true);

		const snapshotPlan = await BuildRestorePlan(guild, emptySnapshot(166), RESTORE_PRESETS.FULL);
		expect(snapshotPlan.warnings.some(w => w.includes('import'))).toBe(false);
	});

	it('warns about roles at or above the bot, but not about creates', async () => {
		// A role the bot cannot reach: the write will fail, and the admin should hear about it first.
		// A CREATE has no live counterpart to be blocked by, so it must not warn
		// Admin sits above the bot and has drifted (colour), so it is an UPDATE that will fail.
		// Member has drifted too but sits below the bot, so it is fine
		const guild = makeGuild([BOT_ROLE, EVERYONE, role(2n, 'Admin', { position: 10 }), role(3n, 'Member', { position: 1 })], [], { botHighestPosition: 5 });
		const snapshot = makeSnapshot(163, [
			BOT_ROLE, EVERYONE,
			role(2n, 'Admin', { position: 10, color: 0xff0000 }),
			role(3n, 'Member', { position: 1, color: 0x00ff00 }),
			role(4n, 'New', { position: 4 })
		], []);

		const plan = await BuildRestorePlan(guild, snapshot, RESTORE_OPTIONS.ROLES);

		expect(plan.actions.find(a => a.target_id === 4n)!.change_type).toBe(DIFF_CHANGE_TYPE.CREATE);
		expect(plan.warnings).toEqual([expect.stringContaining('@Admin')]);
	});

	it('falls back to position 0 when the bot has no member object', async () => {
		// `members.me` is null until the member is cached; the warning pass must degrade rather than
		// take down the whole preview
		const guild = makeGuild([BOT_ROLE, EVERYONE, MOD], [], { noBotMember: true });

		const plan = await BuildRestorePlan(guild, emptySnapshot(164), RESTORE_OPTIONS.ROLES);

		expect(plan.actions.map(a => a.target_id)).toEqual([2n]);
		expect(plan.warnings.some(w => w.includes('@Mod'))).toBe(true);
	});

	it('does not mutate the live guild', async () => {
		// `CreateSnapshotDiff` reorders roles in place; it must only ever see the comparable copy
		const guild = makeGuild([BOT_ROLE, EVERYONE, role(3n, 'Owner', { position: 60 })], []);
		const before = Array.from(guild.roles.cache.values()).map(r => ({ id: r.id, position: r.position }));

		await BuildRestorePlan(guild, emptySnapshot(165), RESTORE_PRESETS.FULL);

		expect(Array.from(guild.roles.cache.values()).map(r => ({ id: r.id, position: r.position }))).toEqual(before);
	});
});

describe('BuildRestorePlan - diff failures (Bug #9)', () => {
	it('explains a missing bot role in terms of imports', async () => {
		const guild = makeGuild([BOT_ROLE, EVERYONE, MOD], []);
		// A snapshot with roles but none owned by this bot - the usual cause is an import from a
		// server this bot was never in
		const snapshot = makeSnapshot(170, [EVERYONE, MOD], []);

		await expect(BuildRestorePlan(guild, snapshot, RESTORE_PRESETS.FULL)).rejects.toThrow(RestorePlanError);
		await expect(BuildRestorePlan(guild, snapshot, RESTORE_PRESETS.FULL)).rejects.toThrow(/imported from another server/);
	});

	it('does not mislabel an unrelated diff failure as a missing bot role', async () => {
		// A channel whose overwrites are missing entirely makes `DeepEquals` throw a TypeError deep
		// inside the diff. Whatever the cause, telling the admin their snapshot has no bot role sends
		// them hunting for something that is not wrong
		const broken = { ...GENERAL, permission_overwrites: undefined } as unknown as ChannelFixture;
		const guild = makeGuild([BOT_ROLE, EVERYONE], [broken]);
		const snapshot = makeSnapshot(171, [BOT_ROLE, EVERYONE], [GENERAL]);

		const rejection = BuildRestorePlan(guild, snapshot, RESTORE_PRESETS.FULL);
		await expect(rejection).rejects.toThrow(RestorePlanError);
		await expect(rejection).rejects.toThrow(/has been logged/);
		await expect(rejection).rejects.not.toThrow(/no role matching this bot/);

		// ...and it is not silently swallowed either - a real diff bug has to reach the operator
		expect(LogSpy).toHaveBeenCalledWith('ERROR', expect.any(TypeError));
	});
});
