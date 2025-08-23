const { SetGuildTOS, SetUserTOS, GetGuildTOS, GetUserTOS } = require("../Utils/Caching/TOS");
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

const ALREADY_ACCEPTED = {
	color: COLOR.PRIMARY,
	description: `
**You have already accepted the terms.**
You can start using the bot at any time, no need to accept again.`
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

		let embed;
		if (interaction.user.id === guild.ownerId) {
			// owner path accepts entire guild
			if (await GetGuildTOS(guild.id)) {
				embed = ALREADY_ACCEPTED;
			} else {
				SetGuildTOS(guild.id, true);
				embed = SERVER_EMBED;
			}
		} else {
			// user path accepts only themselves
			if (GetUserTOS(interaction.user.id)) {
				embed = ALREADY_ACCEPTED;
			} else {
				SetUserTOS(interaction.user.id, true);
				embed = USER_EMBED;
			}
		}

		interaction.update({ embeds: [embed], components: [] });
	}
}
