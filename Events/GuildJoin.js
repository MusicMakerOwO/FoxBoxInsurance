const Database = require("../Utils/Database");
const { success } = require("../Utils/Logs");
const { AcceptedCache } = require("./Messages")

module.exports = {
	name: 'guildCreate',
	execute: async function(client, guild) {
		success(`Joined new guild: ${guild.name} (${guild.id})`);

		Database.prepare(`
			INSERT INTO Guilds (id, name, accepted_terms)
			VALUES (?, ?, 0)
			ON CONFLICT(id) DO
			UPDATE SET
				name = excluded.name,
				accepted_terms = 0;
		`).run(guild.id, guild.name);
		
		AcceptedCache.set(guild.id, false);
	}
}