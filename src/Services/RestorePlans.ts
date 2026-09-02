import { ChannelType, Guild } from "discord.js";
import { createHash } from "node:crypto";
import { RESTORE_OPTIONS, DIFF_CHANGE_TYPE, SECONDS, SNAPSHOT_TYPE } from "../Utils/Constants.js";
import { ObjectValues } from "../Typings/HelperTypes.js";
import { SnapshotBan, SnapshotChannel, SnapshotRole } from "../Typings/DatabaseTypes.js";
import { Snapshot, JSONSnapshot } from "../CRUD/Snapshots.js";
import { BuildSnapshotComparison } from "../Utils/Snapshots/BuildSnapshotComparison.js";
import { ComparableEntry, CreateSnapshotDiff, SnapshotComparable } from "../Utils/Snapshots/GuildDiff.js";
import { TTLCache } from "../Utils/DataStructures/TTLCache.js";
import { DiscordPermissions } from "../Utils/DiscordConstants.js";
import { RemoveFormatting } from "../Utils/RemoveFormatting.js";
import { Log } from "../Utils/Log.js";

/** Thrown when a plan cannot be computed - callers must render this as a friendly embed, never a stack trace */
export class RestorePlanError extends Error {}

type BaseRestoreAction<Category, Payload extends object> = {
	category   : Category;
	change_type: ObjectValues<typeof DIFF_CHANGE_TYPE>;
	target_id  : bigint;
	/** "#raid-log", "@Event Host", "<@123>" - resolved at plan time */
	label      : string;
	/** The desired end state. Null for DELETE - this is what a future runner would apply */
	payload    : Payload | null;
	/** Which fields changed, e.g. "name, topic, 2 overwrites" - UPDATE only */
	detail     : string | null;
};

export type RestoreChannelAction = BaseRestoreAction<typeof RESTORE_OPTIONS.CHANNELS, ComparableEntry<SnapshotChannel>>;
export type RestoreRoleAction    = BaseRestoreAction<typeof RESTORE_OPTIONS.ROLES,    ComparableEntry<SnapshotRole>>;
export type RestoreBanAction     = BaseRestoreAction<typeof RESTORE_OPTIONS.BANS,     ComparableEntry<SnapshotBan>>;

/**
 * Discriminated on `category` so a runner can narrow `payload` to the entity it is applying.
 * A single `ComparableEntry<SnapshotChannel | SnapshotRole | SnapshotBan>` collapses to
 * `{ id: bigint }` - `Omit` over a union keeps only the keys every member shares.
 */
export type RestoreAction = RestoreChannelAction | RestoreRoleAction | RestoreBanAction;

export type RestorePlan = {
	/** Number for stored snapshots, export ID for imports - always stringified */
	snapshot_id : string;
	guild_id    : string;
	mask        : number;
	/** Sorted: category, then CREATE -> UPDATE -> DELETE (also the eventual apply order) */
	actions     : RestoreAction[];
	/** Hierarchy / missing-permission predictions - display only, not exhaustive validation */
	warnings    : string[];
	/** sha256 of the action tuples, for staleness checks against a freshly rebuilt plan */
	fingerprint : string;
	created_at  : number;
};

const planCache = new TTLCache<string, RestorePlan>();
const PLAN_CACHE_TTL = SECONDS.MINUTE * 15 * 1000;

function CacheKey(guildID: string, snapshotID: string, mask: number): string {
	return `${guildID}:${snapshotID}:${mask}`;
}

export function GetCachedPlan(guildID: string, snapshotID: string, mask: number): RestorePlan | null {
	return planCache.get(CacheKey(guildID, snapshotID, mask));
}

/**
 * Evicts cached plans so the next `BuildRestorePlan` re-diffs against the live guild.
 *
 * Needed because `TTLCache.get` refreshes the expiry on every read, so a plan clicked through
 * every few minutes never ages out - without this, a "rebuild and compare fingerprints" staleness
 * check would compare a plan against itself and always pass. Also called once a restore finishes,
 * since every cached plan for that guild is stale by definition afterwards.
 *
 * Omit `snapshotID` to clear every plan for the guild, or `mask` to clear every mask for that
 * snapshot. Narrow where you can: a snapshot-wide eviction also drops the preview another admin is
 * mid-way through reading on a different scope.
 */
export function InvalidateRestorePlans(guildID: string, snapshotID?: string, mask?: number): void {
	// An exact key, not a prefix - `...:7` is a prefix of `...:70`
	if (snapshotID !== undefined && mask !== undefined) {
		planCache.delete(CacheKey(guildID, snapshotID, mask));
		return;
	}

	const prefix = snapshotID === undefined ? `${guildID}:` : `${guildID}:${snapshotID}:`;

	for (const key of planCache.keys()) {
		if (key.startsWith(prefix)) planCache.delete(key);
	}
}

/**
 * `CreateSnapshotDiff` mutates the role lists it's given (moving the bot role to the top in
 * place) - the snapshot side here is pulled straight out of `GetSnapshot`'s LRU cache, so it
 * must be copied before diffing or repeated preview clicks would poison later reads of the
 * same cached snapshot.
 */
function DeepCopyComparable(comparable: SnapshotComparable): SnapshotComparable {
	return {
		roles   : new Map(Array.from(comparable.roles, ([id, role]) => [id, { ...role }])),
		channels: new Map(Array.from(comparable.channels, ([id, channel]) => [id, { ...channel, permission_overwrites: { ...channel.permission_overwrites } }])),
		bans    : new Map(Array.from(comparable.bans, ([id, ban]) => [id, { ...ban }])),
	};
}

/**
 * `@everyone` is a real role and its permissions are worth restoring, but it is keyed on the guild's
 * own snowflake. A snapshot taken in another server therefore pairs its `@everyone` against nothing,
 * and the diff emits a DELETE of *this* server's `@everyone` plus a CREATE that Discord rejects.
 *
 * Re-keying the snapshot's copy onto the live guild collapses that into a single UPDATE, which
 * `ApplyRoleAction` narrows to a permissions-only edit. Channel overwrites are re-keyed with it, or
 * every `@everyone` overwrite in the snapshot would be dropped as an unknown role at apply time.
 *
 * Mutates the copy from `DeepCopyComparable`, never the cached snapshot.
 */
function NormalizeEveryoneRole(guild: Guild, comparable: SnapshotComparable): void {
	const everyoneID = BigInt(guild.id);
	if (comparable.roles.has(everyoneID)) return;

	// Discord does not allow renaming `@everyone`, so the name is a reliable marker - and it is the
	// only one available for imports, which strip the source guild ID on export
	const found = Array.from(comparable.roles.entries()).find(([ , role ]) => role.name === '@everyone');
	if (!found) return;

	const [ previousID, role ] = found;
	comparable.roles.delete(previousID);
	comparable.roles.set(everyoneID, { ...role, id: everyoneID });

	const previousKey = previousID.toString();
	for (const channel of comparable.channels.values()) {
		const overwrite = channel.permission_overwrites[previousKey];
		if (!overwrite) continue;

		delete channel.permission_overwrites[previousKey];
		channel.permission_overwrites[everyoneID.toString()] = overwrite;
	}
}

/**
 * Managed roles (bot/integration/booster roles) can't be created, edited, or deleted through
 * the API. Snapshot data marks bot-owned roles via `managed_by`, but that doesn't cover every
 * managed role (e.g. the booster role) - fall back to the live guild's `Role.managed` flag for
 * roles that already exist there.
 */
function IsFilteredRole(guild: Guild, role: ComparableEntry<SnapshotRole>, changeType: ObjectValues<typeof DIFF_CHANGE_TYPE>): boolean {
	// `@everyone` cannot be created or deleted - only its permissions edited, which `ApplyRoleAction`
	// handles. `NormalizeEveryoneRole` makes the UPDATE the normal case; this catches a snapshot that
	// holds no `@everyone` at all, which would otherwise try to delete this server's
	if (role.id === BigInt(guild.id)) return changeType !== DIFF_CHANGE_TYPE.UPDATE;

	if (role.managed_by !== null) return true;
	return guild.roles.cache.get(role.id.toString())?.managed ?? false;
}

function RoleLabel(role: ComparableEntry<SnapshotRole>): string {
	return `@${RemoveFormatting(role.name)}`;
}

function ChannelLabel(channel: ComparableEntry<SnapshotChannel>): string {
	return `#${RemoveFormatting(channel.name)}`;
}

function BanLabel(ban: ComparableEntry<SnapshotBan>): string {
	return `<@${ban.id}>`;
}

/**
 * Fixed apply order: roles create/update, categories create/update, channels create/update, bans
 * create, then deletes (channels, categories, roles, bans).
 *
 * Child channels are deleted before the categories holding them. Discord reparents a category's
 * children to the server root when the category goes first, which is visible to everyone while the
 * run finishes - and permanent if it never does.
 */
function ActionRank(category: ObjectValues<typeof RESTORE_OPTIONS>, changeType: ObjectValues<typeof DIFF_CHANGE_TYPE>, isCategoryChannel: boolean): number {
	if (category === RESTORE_OPTIONS.ROLES) {
		if (changeType === DIFF_CHANGE_TYPE.DELETE) return 9;
		return changeType === DIFF_CHANGE_TYPE.CREATE ? 0 : 1;
	}
	if (category === RESTORE_OPTIONS.CHANNELS) {
		if (changeType === DIFF_CHANGE_TYPE.DELETE) return isCategoryChannel ? 8 : 7;
		if (isCategoryChannel) return changeType === DIFF_CHANGE_TYPE.CREATE ? 2 : 3;
		return changeType === DIFF_CHANGE_TYPE.CREATE ? 4 : 5;
	}
	// BANS
	return changeType === DIFF_CHANGE_TYPE.DELETE ? 10 : 6;
}

export async function BuildRestorePlan(guild: Guild, snapshot: Snapshot | JSONSnapshot, mask: number): Promise<RestorePlan> {
	const snapshotID = String(snapshot.id);

	const cached = GetCachedPlan(guild.id, snapshotID, mask);
	if (cached) return cached;

	const liveComparable = await BuildSnapshotComparison(guild);
	const snapshotComparable = DeepCopyComparable(await BuildSnapshotComparison(snapshot));
	NormalizeEveryoneRole(guild, snapshotComparable);

	let diff;
	try {
		diff = CreateSnapshotDiff(liveComparable, snapshotComparable);
	} catch (error) {
		// `CreateSnapshotDiff` has exactly one intentional throw (`MoveBotRoleToTop`). Anything else
		// is a bug in the diff, and reporting it as the import problem below sends admins hunting for
		// something that is not wrong - so log it and say only what we actually know
		Log('ERROR', error);

		if (error instanceof Error && error.message.startsWith('Could not find a bot role')) {
			throw new RestorePlanError('Could not compute a restore plan: this snapshot has no role matching this bot. This is common for snapshots imported from another server.');
		}

		throw new RestorePlanError('Could not compute a restore plan for this snapshot. The error has been logged - try again, and report it if it keeps happening.');
	}

	const ranked: { rank: number, action: RestoreAction }[] = [];

	if (mask & RESTORE_OPTIONS.ROLES) {
		for (const { change_type, detail, ...role } of diff.roles.values()) {
			if (IsFilteredRole(guild, role, change_type)) continue;

			ranked.push({
				rank: ActionRank(RESTORE_OPTIONS.ROLES, change_type, false),
				action: {
					category: RESTORE_OPTIONS.ROLES,
					change_type,
					target_id: role.id,
					label: RoleLabel(role),
					payload: change_type === DIFF_CHANGE_TYPE.DELETE ? null : role,
					detail: detail ?? null,
				}
			});
		}
	}

	if (mask & RESTORE_OPTIONS.CHANNELS) {
		for (const { change_type, detail, ...channel } of diff.channels.values()) {
			const isCategoryChannel = channel.type === ChannelType.GuildCategory;

			ranked.push({
				rank: ActionRank(RESTORE_OPTIONS.CHANNELS, change_type, isCategoryChannel),
				action: {
					category: RESTORE_OPTIONS.CHANNELS,
					change_type,
					target_id: channel.id,
					label: ChannelLabel(channel),
					payload: change_type === DIFF_CHANGE_TYPE.DELETE ? null : channel,
					detail: detail ?? null,
				}
			});
		}
	}

	if (mask & RESTORE_OPTIONS.BANS) {
		for (const { change_type, ...ban } of diff.bans.values()) {
			// A ban UPDATE only ever means the reason text drifted. Restore cares that the user is
			// banned, not why, and Discord has no edit-ban API - so this is not a restorable action
			// and must not inflate the preview counts either.
			if (change_type === DIFF_CHANGE_TYPE.UPDATE) continue;

			ranked.push({
				rank: ActionRank(RESTORE_OPTIONS.BANS, change_type, false),
				action: {
					category: RESTORE_OPTIONS.BANS,
					change_type,
					target_id: ban.id,
					label: BanLabel(ban),
					payload: change_type === DIFF_CHANGE_TYPE.DELETE ? null : ban,
					detail: null,
				}
			});
		}
	}

	ranked.sort((a, b) => a.rank - b.rank);
	const actions = ranked.map(entry => entry.action);

	const warnings: string[] = [];
	const botMember = guild.members.me;

	if ((mask & RESTORE_OPTIONS.CHANNELS) && !botMember?.permissions.has(DiscordPermissions.ManageChannels)) {
		warnings.push('I am missing the `Manage Channels` permission - channel changes may fail.');
	}
	if ((mask & RESTORE_OPTIONS.ROLES) && !botMember?.permissions.has(DiscordPermissions.ManageRoles)) {
		warnings.push('I am missing the `Manage Roles` permission - role changes may fail.');
	}
	if ((mask & RESTORE_OPTIONS.BANS) && !botMember?.permissions.has(DiscordPermissions.BanMembers)) {
		warnings.push('I am missing the `Ban Members` permission - ban changes may fail.');
	}

	const botHighestPosition = botMember?.roles.highest.position ?? 0;
	for (const action of actions) {
		if (action.category !== RESTORE_OPTIONS.ROLES || action.change_type === DIFF_CHANGE_TYPE.CREATE) continue;

		const livePosition = guild.roles.cache.get(action.target_id.toString())?.position;
		if (livePosition !== undefined && livePosition >= botHighestPosition) {
			warnings.push(`${action.label} is at or above my highest role - this change may fail.`);
		}
	}

	// Imports are portable across guilds, but snowflakes are not - if this one came from a
	// different server, nothing will match by ID and the diff above is a full delete-and-recreate
	// rather than in-place updates. There's no reliable way to tell "reimported into its own source
	// guild" apart from "uploaded somewhere else" at this layer, so warn unconditionally on imports.
	if (snapshot.type === SNAPSHOT_TYPE.IMPORT) {
		warnings.push('This is an import - if it came from another server, IDs won\'t match and this will delete and recreate channels, roles, and bans instead of updating them in place.');
	}

	// This is a consent check, not a safety one: the plan is rebuilt at confirm so a stale plan is
	// never applied, and the safety snapshot is taken after any drift so rollback already works. All
	// it has to answer is "is this the same set of things the admin was shown".
	//
	// Hashing the ordered action array instead made it answer more than that. Ties in the rank sort
	// follow discord.js cache iteration order, so a cache re-insertion between preview and confirm
	// could change the hash with an identical action set - a refusal that costs the admin their whole
	// preview. Sorting removes that by construction. Payloads are excluded because they cannot drift:
	// they come from the immutable snapshot row, and `MoveBotRoleToTop` normalizes each side against
	// its own highest role rather than the live guild's.
	const identity = actions
		.map(action => `${action.category}:${action.change_type}:${action.target_id}`)
		.sort()
		.join('\n');

	const fingerprint = createHash('sha256').update(identity).digest('hex');

	const plan: RestorePlan = {
		snapshot_id: snapshotID,
		guild_id: guild.id,
		mask,
		actions,
		warnings,
		fingerprint,
		created_at: Date.now(),
	};

	planCache.set(CacheKey(guild.id, snapshotID, mask), plan, PLAN_CACHE_TTL);
	return plan;
}