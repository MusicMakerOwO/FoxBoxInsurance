const { error } = require("../Utils/Logs")

module.exports = {
	name: 'guildDelete',
	execute: async function(client, guild) {
		error(`Left guild: ${guild.name} (${guild.id})`);
	}
}