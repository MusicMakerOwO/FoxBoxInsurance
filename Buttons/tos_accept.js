const { SetGuildTOS, SetUserTOS } = require("../Utils/Caching/TOS");
const { COLOR } = require("../Utils/Constants");

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

		let embed = USER_EMBED;

		SetUserTOS(interaction.user.id, true);
		if (interaction.user.id === guild.ownerId) {
			// if the user is the server owner, update the server as well
			SetGuildTOS(guildID, true);
			embed = SERVER_EMBED;
		}

		interaction.update({ embeds: [embed], components: [] });
	}
}