const Database = require("../Utils/Database");

module.exports = {
	name: 'guildBanAdd',
	execute: async function(client, member) {
		// automatically block the user from using exports
		// The admins can undo this but this is a good way to prevent abuse
		await Database.query(`
			INSERT INTO GuildBlocks (guild_id, user_id, moderator_id)
			VALUES (?, ?, ?)
			ON DUPLICATE KEY UPDATE moderator_id = excluded.moderator_id
		`, [member.guild.id, member.user.id, null]);
	}
}