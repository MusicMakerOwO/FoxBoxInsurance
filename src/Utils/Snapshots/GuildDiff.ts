import { ChannelType } from "discord.js";
import {
	SnapshotBan,
	SnapshotChannel,
	SnapshotRole
} from "../../Typings/DatabaseTypes";
import { ObjectValues } from "../../Typings/HelperTypes";
import { client } from "../../Client";
import { DIFF_CHANGE_TYPE } from "../Constants";

const ALLOWED_CHANNEL_TYPES = new Set([
	ChannelType.GuildText,
	ChannelType.GuildVoice,
	ChannelType.GuildCategory,
	ChannelType.GuildAnnouncement,
	ChannelType.AnnouncementThread,
	ChannelType.GuildStageVoice,
	ChannelType.GuildForum,
	ChannelType.GuildMedia
]);

type DiffEntry<T extends {}> = Omit<T, 'snapshot_id' | 'deleted'> & { change_type: ObjectValues<typeof DIFF_CHANGE_TYPE> }

export type GuildDiff = {
	roles: Map<SnapshotRole   ['id'], DiffEntry<SnapshotRole>>,
	channels: Map<SnapshotChannel['id'], DiffEntry<SnapshotChannel>>,
	bans: Map<SnapshotBan    ['id'], DiffEntry<SnapshotBan>>
}

function DeepEquals(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
	const aKeys = Object.keys(a);
	const bKeys = Object.keys(b);
	if (aKeys.length !== bKeys.length) return false;
	for (const key of aKeys) {
		if (!(key in b) || a[key] !== b[key]) return false;
	}
	return true;
}

/**
 * Mutates the data in place to move the bot role to the top if not already
 */
function MoveBotRoleToTop(roleList: SnapshotComparable['roles']) {
	const roles = Array.from(roleList.values()) as ComparableEntry<SnapshotRole>[];

	const highestRole = roles.reduce((highest, role) => role.position > highest.position ? role : highest, roles.values().next().value!);

	const botRole = roles.find(role => {
		if ('managed_by' in role) {
			return role.managed_by === BigInt(client.user!.id)
		}
	});
	if (!botRole) {
		if (roles.length >= 1) throw new Error('Could not find a bot role in the provided guild - Was the bot given no permissions upon invite?');
		return;
	}

	if (botRole.position === highestRole.position) return;

	// bot role is not at the top, move everything above it down
	for (const role of roles.values()) {
		if (role.id === botRole.id) {
			// move bot role to the top
			if ('rawPosition' in role) {
				role.rawPosition = highestRole.position
			} else {
				role.position = highestRole.position + 1;
			}
		}
	}
}

export type ComparableEntry<T extends {}> = Omit<T, 'snapshot_id' | 'deleted'>;

export type SnapshotComparable = {
	roles:       | Map<SnapshotRole   ['id'], ComparableEntry<SnapshotRole>>;
	channels:    | Map<SnapshotChannel['id'], ComparableEntry<SnapshotChannel>>;
	bans:        | Map<SnapshotBan    ['id'], ComparableEntry<SnapshotBan>>;
}

/**
 * Returns a diff of actions to turn the `baseSnapshot` into the `targetSnapshot`. If `targetSnapshot` is omitted then everything is marked as `CREATE`
 * @param baseSnapshot
 * @param targetSnapshot
 * @constructor
 */
export function CreateSnapshotDiff(baseSnapshot: SnapshotComparable, targetSnapshot: SnapshotComparable): GuildDiff {
	const globalDiff: GuildDiff = {
		roles   : new Map(),
		channels: new Map(),
		bans    : new Map()
	}

	MoveBotRoleToTop(baseSnapshot.roles);
	MoveBotRoleToTop(targetSnapshot.roles);

	//////////////////
	// deletions first
	//////////////////

	for (const baseRole of baseSnapshot.roles.values()) {
		const RoleCacheKey = baseRole.id;
		const targetRole = targetSnapshot.roles.get(baseRole.id);
		if (!targetRole) {
			globalDiff.roles.set(RoleCacheKey, {
				change_type: DIFF_CHANGE_TYPE.DELETE,
				... baseRole
			});
		} else if (
			baseRole.name !== targetRole.name ||
			baseRole.color !== targetRole.color ||
			baseRole.hoist !== +targetRole.hoist ||
			baseRole.position !== targetRole.position ||
			baseRole.permissions !== targetRole.permissions ||
			baseRole.managed_by !== targetRole.managed_by
		) {
			globalDiff.roles.set(RoleCacheKey, {
				change_type: DIFF_CHANGE_TYPE.UPDATE,
				... targetRole
			})
		}
	}

	for (const baseChannel of baseSnapshot.channels.values()) {
		const ChannelCacheKey = baseChannel.id;
		const targetChannel = targetSnapshot.channels.get(baseChannel.id);

		if (!targetChannel) {
			globalDiff.channels.set(ChannelCacheKey, {
				change_type: DIFF_CHANGE_TYPE.DELETE,
				... baseChannel
			});
		} else if (
			baseChannel.name !== targetChannel.name ||
			baseChannel.parent_id !== targetChannel.parent_id ||
			('position' in baseChannel && baseChannel.position !== targetChannel.position) ||
			('topic' in baseChannel && baseChannel.topic !== targetChannel.topic) ||
			('nsfw' in baseChannel && baseChannel.nsfw !== +targetChannel.nsfw) ||
			( ! DeepEquals(baseChannel.permission_overwrites, targetChannel.permission_overwrites) )
		) {
			globalDiff.channels.set(ChannelCacheKey, {
				change_type: DIFF_CHANGE_TYPE.UPDATE,
				... targetChannel
			})
		}
	}

	for (const baseBan of baseSnapshot.bans.values()) {
		const targetBan = targetSnapshot.bans.get(baseBan.id);
		if (!targetBan) {
			globalDiff.bans.set(baseBan.id, {
				change_type: DIFF_CHANGE_TYPE.DELETE,
				... baseBan
			});
		} else if (baseBan.reason !== targetBan.reason) {
			globalDiff.bans.set(baseBan.id, {
				change_type: DIFF_CHANGE_TYPE.UPDATE,
				... baseBan,
				reason: targetBan.reason ?? 'No reason provided'
			})
		}
	}

	//////////////////
	// creations last
	//////////////////

	for (const role of targetSnapshot.roles.values()) {
		if (!baseSnapshot.roles.has(role.id)) {
			globalDiff.roles.set(role.id, {
				change_type: DIFF_CHANGE_TYPE.CREATE,
				... role
			})
		}
	}

	for (const channel of targetSnapshot.channels.values()) {
		if (!ALLOWED_CHANNEL_TYPES.has(channel.type)) continue;
		if (!baseSnapshot.channels.has(channel.id)) {
			globalDiff.channels.set(channel.id, {
				change_type: DIFF_CHANGE_TYPE.CREATE,
				... channel
			});
		}
	}

	for (const targetBan of targetSnapshot.bans.values()) {
		if (!baseSnapshot.bans.has(targetBan.id)) {
			globalDiff.bans.set(targetBan.id, {
				change_type: DIFF_CHANGE_TYPE.CREATE,
				... targetBan
			});
		}
	}

	return globalDiff;
}