const { COLOR } = require("../Utils/Constants");
const Database = require("../Utils/Database");

const USER_EMBED = {
	color: COLOR.PRIMARY,
	description: `
**Thank you for accepting the terms.**
Please run the last command again to get started.`
}

const SERVER_EMBED = {
	color: COLOR.PRIMARY,
	description: `
**Thank you for accepting the terms.**
You can now start using the bot within this server.`
}

module.exports = {
	allow_dm: true,
	bypass: true,
	customID: 'tos-accept',
	execute: async function(interaction, client, args) {
		const guildID = args[0] ?? interaction.guild?.id;
		if (!guildID) throw new Error('Guild ID not found');

		const guild = client.guilds.cache.get(guildID);
		if (!guild) throw new Error('Guild not found');

		Database.prepare(`UPDATE Users SET accepted_terms = 1 WHERE id = ?`).run(interaction.user.id);
		if (interaction.user.id === guild.ownerId) {
			// if the user is the server owner, update the server as well
			Database.prepare(`UPDATE Guilds SET accepted_terms = 1 WHERE id = ?`).run(guildID);
			await interaction.update({ embeds: [SERVER_EMBED], components: [] }).catch(() => {});
		} else {
			await interaction.update({ embeds: [USER_EMBED], components: [] }).catch(() => {});
		}
	}
}