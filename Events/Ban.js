const Database = require("../Utils/Database");

module.exports = {
	name: 'guildBanAdd',
	execute: async function(client, member) {
		// automatically block the user from using exports
		// The admins can undo this but this is a good way to prevent abuse
		Database.prepare(`
			INSERT INTO GuildBlocks (guild_id, user_id, moderator_id)
			VALUES (?, ?, ?)
			ON CONFLICT(guild_id, user_id) DO NOTHING
		`).run(member.guild.id, member.user.id, null);
	}
}