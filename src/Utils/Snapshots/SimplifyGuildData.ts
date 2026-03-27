import { SnapshotBan, SnapshotChannel, SnapshotRole } from "../../Typings/DatabaseTypes";
import { GuildBan, GuildBasedChannel, Role } from "discord.js";

type StripMetadata<T extends {}> = Omit<T, 'snapshot_id' | 'deleted'>;

export function SimplifyRole(role: StripMetadata<SnapshotRole> | Role): StripMetadata<SnapshotRole> {
	return {
		id         : BigInt(role.id),
		name       : role.name,
		color      : role.color,
		position   : role.position,
		hoist      : +role.hoist as 1 | 0,
		managed_by : 'managed_by' in role ? role.managed_by : (role.tags?.botId ? BigInt(role.tags!.botId!) : null),
		permissions: typeof role.permissions === 'bigint' ? role.permissions : role.permissions.bitfield
	}
}

export function SimplifyChannel(channel: StripMetadata<SnapshotChannel> | GuildBasedChannel): StripMetadata<SnapshotChannel> {
	const output: ReturnType<typeof SimplifyChannel> = {
		id                   : BigInt(channel.id),
		name                 : channel.name,
		type                 : channel.type,
		position             : 'position' in channel ? channel.position : 0,
		topic                : 'topic' in channel ? channel.topic : null,
		nsfw                 : 'nsfw' in channel ? +channel.nsfw as 1 | 0 : 0,
		parent_id            : 'parent_id' in channel ? channel.parent_id : (channel.parentId ? BigInt(channel.parentId) : null),
		permission_overwrites: {}
	}
	if ('guild' in channel) {
		if ('permissionOverwrites' in channel) {
			for (const overwrite of channel.permissionOverwrites.cache.values()) {
				output.permission_overwrites[overwrite.id] = {
					allow: String(overwrite.allow.bitfield),
					deny : String(overwrite.deny.bitfield),
					type : overwrite.type
				}
			}
		}
	} else {
		output.permission_overwrites = channel.permission_overwrites
	}
	return output;
}

export function SimplifyBan(ban: StripMetadata<SnapshotBan> | GuildBan): StripMetadata<SnapshotBan> {
	return {
		id    : 'id' in ban ? ban.id : BigInt(ban.user.id),
		reason: ban.reason ?? 'No reason provided'
	}
}