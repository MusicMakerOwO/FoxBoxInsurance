const { GuildChannel, Role, GuildBan, PermissionOverwrites, InteractionContextType } = require('discord.js');

function PermKey(channelID, roleID) {
	return `${channelID}-${roleID}`;
}

function SimplifyChannel(channel) {
	if (channel instanceof GuildChannel) return {
		id: channel.id,
		type: channel.type,
		name: channel.name,
		position: channel.rawPosition,
		topic: channel.topic ?? null,
		nsfw: channel.nsfw ? 1 : 0,
		parent_id: channel.parentId ?? null
	}

	if (typeof channel.id !== 'string' || channel.id.length === 0) {
		throw new Error('Channel ID must be a non-empty string');
	}

	return {
		id: channel.id,
		type: channel.type ?? 0,
		name: channel.name ?? 'Unknown',
		position: channel.position ?? 0,
		topic: channel.topic ?? null,
		nsfw: channel.nsfw ? 1 : 0,
		parent_id: channel.parent_id ?? null
	}
}

function SimplifyRole(role) {
	if (role instanceof Role) return {
		id: role.id,
		name: role.name,
		color: role.color,
		hoist: +role.hoist || 0,
		position: role.rawPosition,
		permissions: String(role.permissions.bitfield),
		managed: +role.managed || 0
	}

	if (typeof role.id !== 'string' || role.id.length === 0) {
		throw new Error('Role ID must be a non-empty string');
	}

	return {
		id: role.id,
		name: role.name ?? 'Unknown',
		color: role.color ?? 0,
		hoist: +role.hoist || 0,
		position: role.position ?? 0,
		permissions: role.permissions ?? '0',
		managed: +role.managed || 0
	}
}

function SimplifyPermission(channelID, permission) {
	if (permission instanceof PermissionOverwrites) return {
		id: PermKey(channelID, permission.id),
		channel_id: channelID,
		role_id: permission.id,
		allow: permission.allow.bitfield,
		deny: permission.deny.bitfield,
	}

	if (typeof channelID !== 'string' || channelID.length === 0) {
		throw new Error('Channel ID must be a non-empty string');
	}

	if (typeof permission.role_id !== 'string' || permission.role_id.length === 0) {
		throw new Error('Role ID must be a non-empty string');
	}

	return {
		id: PermKey(channelID, permission.role_id),
		channel_id: channelID,
		role_id: permission.role_id,
		allow: permission.allow ?? 0n,
		deny: permission.deny ?? 0n
	}
}

function SimplifyBan(ban) {
	if (ban instanceof GuildBan) return {
		user_id: ban.user.id,
		reason: ban.reason ?? 'No reason provided',
	}

	if (typeof ban.user_id !== 'string' || ban.user_id.length === 0) {
		throw new Error('User ID must be a non-empty string');
	}

	return {
		user_id: ban.user_id,
		reason: ban.reason ?? 'No reason provided',
	}
}

const DEFAULT_COMMAND_ACCESS = [ InteractionContextType.Guild ];

function SimplifyCommand(command) {
	return {
		name: command.name ?? '',
		description: command.description ?? '',
		type: command.type ?? 1,
		options: command.options ?? [],
		contexts: command.contexts ?? DEFAULT_COMMAND_ACCESS,
		nsfw: command.nsfw ?? false
	}
}

function SimplifyMessage(message) {
	// Simplify message object to only include necessary fields
	return {
		id: message.id,
		user_id: message.user_id,
		content: message.content || null,
		sticker_id: message.sticker_id,
		created_at: message.created_at,
		reply_to: message.reply_to || null // assuming reply_to is a field in the message
	};
}

function SimplifyUser(user) {
	// Simplify user object to only include necessary fields
	return {
		id: user.id,
		username: user.username,
		bot: !!user.bot,
		asset_id: user.asset_id,
		created_at: user.created_at
	}
}

function SimplifyGuild(guild) {
	// Simplify guild object to only include necessary fields
	return {
		id: guild.id,
		name: guild.name,
		asset_id: guild.asset_id,
		created_at: guild.created_at
	}
}

module.exports = {
	PermKey,

	SimplifyChannel,
	SimplifyRole,
	SimplifyPermission,
	SimplifyBan,

	SimplifyCommand,

	SimplifyMessage,
	SimplifyUser,
	SimplifyGuild
};