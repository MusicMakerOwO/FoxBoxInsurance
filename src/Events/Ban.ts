import {EventHandler} from "../Typings/HandlerTypes";
import {GuildMember} from "discord.js";
import {Database} from "../Database";

export default {
	name: 'guildBanAdd',
	execute: async function(member: GuildMember) {
		// automatically block the user from using exports
		// The admins can undo this but this is a good way to prevent abuse
		void Database.query(`
			INSERT INTO GuildBlocks (guild_id, user_id, moderator_id)
			VALUES (?, ?, ?)
			ON DUPLICATE KEY UPDATE moderator_id = moderator_id
		`, [BigInt(member.guild.id), BigInt(member.user.id), null]);
	}
} as EventHandler;