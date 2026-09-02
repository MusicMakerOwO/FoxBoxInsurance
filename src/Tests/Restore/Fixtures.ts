import { vi } from 'vitest';
import { Guild } from 'discord.js';
import {
	DIFF_CHANGE_TYPE,
	RESTORE_OPTIONS,
	RESTORE_RESULT,
	RESTORE_STATUS,
	SNAPSHOT_TYPE
} from '../../Utils/Constants.js';
import { SnapshotRestore, SnapshotRestoreAction } from '../../Typings/DatabaseTypes.js';
import { JSONSnapshot, Snapshot } from '../../CRUD/Snapshots.js';

/**
 * Shared stubs for the `Services/RestorePlans.ts` tests. Deliberately not a `*.test.ts` file, which
 * is why `vitest.config.ts` collects `*.test.ts` rather than every `.ts` under `src/Tests`.
 *
 * Every consumer still needs its own hoisted
 * `vi.mock('../../Client.js', () => ({ client: { user: { id: BOT_USER_ID } } }))` - `vi.mock` is
 * hoisted per module graph and cannot be shared from here.
 */

/** `MoveBotRoleToTop` resolves the bot role through `client.user.id` and throws if neither side has one */
export const BOT_USER_ID = '999';
export const GUILD_ID = '1';

export type RoleFixture = {
	id: bigint,
	name: string,
	color: number,
	position: number,
	hoist: 1 | 0,
	permissions: bigint,
	managed_by: bigint | null,
	/** Live-guild-only flag - `IsFilteredRole` reads it off `guild.roles.cache`, snapshots never carry it */
	managed?: boolean
};

export type Overwrite = { allow: string, deny: string, type: number };

export type ChannelFixture = {
	id: bigint,
	name: string,
	type: number,
	position: number,
	topic: string | null,
	nsfw: 1 | 0,
	parent_id: bigint | null,
	permission_overwrites: Record<string, Overwrite>
};

export type BanFixture = { id: bigint, reason: string };

export function role(id: bigint, name: string, overrides: Partial<RoleFixture> = {}): RoleFixture {
	return { id, name, color: 0, position: Number(id), hoist: 0, permissions: 0n, managed_by: null, ...overrides };
}

export function channel(id: bigint, name: string, type: number, parent: bigint | null, overrides: Partial<ChannelFixture> = {}): ChannelFixture {
	return { id, name, type, position: Number(id), topic: null, nsfw: 0, parent_id: parent, permission_overwrites: {}, ...overrides };
}

export function ban(id: bigint, reason = 'No reason provided'): BanFixture {
	return { id, reason };
}

export function overwrite(allow = '0', deny = '0', type = 0): Overwrite {
	return { allow, deny, type };
}

export const BOT_ROLE = role(999n, 'FBI', { managed_by: BigInt(BOT_USER_ID), position: 50 });
export const EVERYONE = role(BigInt(GUILD_ID), '@everyone');

export type GuildOptions = {
	bans?: BanFixture[];
	/** Which permissions `members.me` holds. Default: all of them, so no warnings fire */
	permissions?: bigint[];
	/** Position of the bot's highest role - anything at or above it triggers a hierarchy warning */
	botHighestPosition?: number;
	/** Drops `members.me` entirely, exercising the `?? 0` fallbacks in the warning pass */
	noBotMember?: boolean;
	id?: string;
};

/**
 * A `Guild` only as far as `BuildSnapshotComparison` and the warning pass look at it: Map-backed
 * caches and a `bans` map (the real path is `instanceof Guild`, which a literal can never satisfy,
 * so `data.bans` is read directly).
 */
export function makeGuild(roles: RoleFixture[], channels: ChannelFixture[], options: GuildOptions = {}): Guild {
	const { bans = [], permissions, botHighestPosition = 100, noBotMember = false, id = GUILD_ID } = options;

	const me = noBotMember ? null : {
		permissions: { has: (permission: bigint) => permissions === undefined || permissions.includes(permission) },
		roles      : { highest: { position: botHighestPosition } }
	};

	return {
		id,
		roles   : { cache: new Map(roles   .map(r => [r.id.toString(), r])) },
		channels: { cache: new Map(channels.map(c => [c.id.toString(), c])) },
		bans    : new Map(bans.map(b => [b.id.toString(), b])),
		members : { me }
	} as unknown as Guild;
}

/** A stored snapshot - Map-backed, keyed on bigint IDs, exactly as `GetSnapshot` returns it */
export function makeSnapshot(id: number, roles: RoleFixture[], channels: ChannelFixture[], bans: BanFixture[] = []): Snapshot {
	return {
		id,
		roles   : new Map(roles   .map(r => [r.id, r])),
		channels: new Map(channels.map(c => [c.id, c])),
		bans    : new Map(bans    .map(b => [b.id, b]))
	} as unknown as Snapshot;
}

/** An uploaded import - array-backed, and its `@everyone` is keyed on the *source* guild's snowflake */
export function makeJSONSnapshot(id: string, roles: RoleFixture[], channels: ChannelFixture[], bans: BanFixture[] = []): JSONSnapshot {
	return { id, version: 2, type: SNAPSHOT_TYPE.IMPORT, roles, channels, bans } as unknown as JSONSnapshot;
}

/** Bare snapshot - carries only the two roles that cannot be absent, so every live entity diffs to a DELETE */
export function emptySnapshot(id: number): Snapshot {
	return makeSnapshot(id, [BOT_ROLE, EVERYONE], []);
}

//////////////////
// Restore runs
//////////////////

/**
 * The frozen clock every restore suite pins `vi.setSystemTime` to, so `started_at` and the duration
 * strings rendered off it are deterministic.
 */
export const RESTORE_NOW = 1_700_000_000_000;

let nextSeq = 0;

/** Restores the `seq` counter so a suite's expectations do not depend on how many actions ran before it */
export function ResetActionSeq(): void {
	nextSeq = 0;
}

/** One `SnapshotRestoreActions` row. `seq` auto-increments, since apply order is the only thing that reads it */
export function restoreAction(overrides: Partial<SnapshotRestoreAction> = {}): SnapshotRestoreAction {
	return {
		restore_id : 1,
		seq        : nextSeq++,
		category   : RESTORE_OPTIONS.ROLES,
		change_type: DIFF_CHANGE_TYPE.CREATE,
		target_id  : 1n,
		new_id     : null,
		label      : '@Mod',
		payload    : null,
		result     : RESTORE_RESULT.PENDING,
		error      : null,
		...overrides
	} as SnapshotRestoreAction;
}

/** One `SnapshotRestores` row, mid-run by default */
export function restoreRecord(overrides: Partial<SnapshotRestore> = {}): SnapshotRestore {
	return {
		id                : 1,
		guild_id          : 10n,
		snapshot_id       : 142,
		import_id         : null,
		safety_snapshot_id: null,
		user_id           : 20n,
		channel_id        : 30n,
		message_id        : 40n,
		mask              : RESTORE_OPTIONS.ROLES,
		status            : RESTORE_STATUS.RUNNING,
		total_actions     : 0,
		applied_actions   : 0,
		started_at        : BigInt(RESTORE_NOW),
		finished_at       : null,
		...overrides
	} as SnapshotRestore;
}

//////////////////
// The apply-path guild
//////////////////

export type ApplyRole = {
	id: string,
	managed: boolean,
	position: number,
	edit: ReturnType<typeof vi.fn>,
	delete: ReturnType<typeof vi.fn>
};

export type ApplyChannel = {
	id: string,
	edit: ReturnType<typeof vi.fn>,
	delete: ReturnType<typeof vi.fn>
};

export type ApplySpies = {
	rolesCreate   : ReturnType<typeof vi.fn>,
	channelsCreate: ReturnType<typeof vi.fn>,
	setPositions  : ReturnType<typeof vi.fn>,
	bansCreate    : ReturnType<typeof vi.fn>,
	bansRemove    : ReturnType<typeof vi.fn>,
};

export type ApplyGuildOptions = {
	roles?: { id: bigint, managed?: boolean, position?: number }[],
	channels?: bigint[],
	botHighestPosition?: number,
	/** Drops `members.me`, so the reposition ceiling falls back to 0 */
	noBotMember?: boolean,
	id?: string,
};

/**
 * A `Guild` as the `Apply*Action` functions drive it: every mutation is a spy, and the two `create`
 * calls insert what they made back into the cache.
 *
 * That write-back is not decoration. `BuildOverwrites` looks a remapped role up in `roles.cache`, and
 * `ApplyChannelAction`'s parent check looks the new category up in `channels.cache` - a stub that only
 * recorded the call would make the "parent was created" cases pass without the remap working at all.
 */
export type ApplyGuild = {
	guild: Guild,
	spies: ApplySpies,
	/** The live caches, so a test can assert on the `edit`/`delete` spy of a specific entity */
	roleCache: Map<string, ApplyRole>,
	channelCache: Map<string, ApplyChannel>,
};

export function makeApplyGuild(options: ApplyGuildOptions = {}): ApplyGuild {
	const { roles = [], channels = [], botHighestPosition = 100, noBotMember = false, id = GUILD_ID } = options;

	const roleCache    = new Map<string, ApplyRole>();
	const channelCache = new Map<string, ApplyChannel>();

	// Well clear of the fixture IDs, so a remapped ID can never be mistaken for a pre-existing one
	let nextSnowflake = 900_000n;

	for (const entry of roles) {
		roleCache.set(String(entry.id), {
			id      : String(entry.id),
			managed : entry.managed ?? false,
			position: entry.position ?? 1,
			edit    : vi.fn().mockResolvedValue(undefined),
			delete  : vi.fn().mockResolvedValue(undefined)
		});
	}

	for (const channelID of channels) {
		channelCache.set(String(channelID), {
			id    : String(channelID),
			edit  : vi.fn().mockResolvedValue(undefined),
			delete: vi.fn().mockResolvedValue(undefined)
		});
	}

	const spies: ApplySpies = {
		rolesCreate: vi.fn(async () => {
			const created: ApplyRole = {
				id      : String(nextSnowflake++),
				managed : false,
				position: 1,
				edit    : vi.fn().mockResolvedValue(undefined),
				delete  : vi.fn().mockResolvedValue(undefined)
			};
			roleCache.set(created.id, created);
			return created;
		}),
		channelsCreate: vi.fn(async () => {
			const created: ApplyChannel = {
				id    : String(nextSnowflake++),
				edit  : vi.fn().mockResolvedValue(undefined),
				delete: vi.fn().mockResolvedValue(undefined)
			};
			channelCache.set(created.id, created);
			return created;
		}),
		setPositions: vi.fn().mockResolvedValue(undefined),
		bansCreate  : vi.fn().mockResolvedValue(undefined),
		bansRemove  : vi.fn().mockResolvedValue(undefined)
	};

	const guild = {
		id,
		members : { me: noBotMember ? null : { roles: { highest: { position: botHighestPosition } } } },
		roles   : { cache: roleCache   , create: spies.rolesCreate   , setPositions: spies.setPositions },
		channels: { cache: channelCache, create: spies.channelsCreate },
		bans    : { create: spies.bansCreate, remove: spies.bansRemove }
	} as unknown as Guild;

	return { guild, spies, roleCache, channelCache };
}
