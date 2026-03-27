import { Channel, Guild, GuildMember, User } from "discord.js";
import {GUILD_FEATURES, SimpleChannel, SimpleGuild, SimpleUser} from "../Typings/DatabaseTypes";
import {GetChannel, SaveChannel} from "../CRUD/Channels";
import {GetGuild, SaveGuild} from "../CRUD/Guilds";
import {GetUser} from "../CRUD/Users";
import {Database} from "../Database";
import { TOS_FEATURES } from "../TOSConstants";
import { CanUserAccessTOSFeature } from "./UserTOS";

export async function CanGuildExport(guildID: Guild['id'] | SimpleGuild['id']) {
	const guild = await GetGuild(guildID);
	if (!guild) throw new Error("Guild does not exist");

	return (guild.features & GUILD_FEATURES.EXPORT_MESSAGES) !== 0
}

export async function SetGuildExportStatus(guildID: Guild['id'] | SimpleGuild['id'], enabled: boolean) {
	const guild = await GetGuild(guildID);
	if (!guild) throw new Error("Guild does not exist");

	if (enabled) {
		guild.features |= GUILD_FEATURES.EXPORT_MESSAGES;
	} else {
		guild.features &= ~GUILD_FEATURES.EXPORT_MESSAGES;
	}

	await SaveGuild(guild);
}

export async function CanChannelExport(channelID: Channel['id'] | SimpleChannel['id']) {
	const channel = await GetChannel(channelID);
	if (!channel) throw new Error("Channel does not exist");

	if ( ! await CanGuildExport(channel.guild_id)) return false;

	return !channel.block_exports;
}

export async function SetChannelExportStatus(channelID: Channel['id'] | SimpleChannel['id'], enabled: boolean) {
	const channel = await GetChannel(channelID);
	if (!channel) throw new Error("Channel does not exist");

	channel.block_exports = +!enabled as 1 | 0

	await SaveChannel(channel);
}

/**
 * Checks channel export settings, server export settings, and whether the user is blocked. \
 * DOES NOT check for permissions!!
 */
export async function CanUserExport (
	userID: User['id'] | SimpleUser['id'],
	channelID: Channel['id'] | SimpleChannel['id']
): Promise<boolean> {
	const user = await GetUser(userID);
	if (!user) throw new Error("User does not exist");

	if ( ! CanUserAccessTOSFeature(user, TOS_FEATURES.MESSAGE_EXPORTS)) return false;

	if ( ! await CanChannelExport(channelID)) return false;

	// will be cached from previous call, no performance penalties
	const guildID = (await GetChannel(channelID))!.guild_id;
	const blocked = await Database.query(`SELECT 1 FROM GuildBlocks WHERE guild_id = ? AND user_id = ?`, [guildID, user.id]).then(x => x[0]) as 1 | null;

	return !blocked && CanUserAccessTOSFeature(user, TOS_FEATURES.MESSAGE_EXPORTS);
}

export async function CanMemberExportChannel(member: GuildMember, channelID: Channel['id']) {
	// admins bypass everything lol
	const isAdmin = member.permissions.has('Administrator');
	if (isAdmin) return true;

	return await CanUserExport(member.user.id, channelID);
}

export async function BlockUserFromExport(
	guildID: Guild['id'] | SimpleGuild['id'],
	userID: User['id'] | SimpleUser['id'],
	moderatorID: User['id'] | null
) {
	await Database.query(`
		INSERT INTO GuildBlocks (guild_id, user_id, moderator_id) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE user_id = user_id
	`, [guildID, userID, moderatorID]);
}

export async function UnblockUser(
	guildID: Guild['id'] | SimpleGuild['id'],
	userID: User['id'] | SimpleUser['id']
) {
	await Database.query(`
		DELETE FROM GuildBlocks WHERE guild_id = ? AND user_id = ?
	`, [guildID, userID]);
}