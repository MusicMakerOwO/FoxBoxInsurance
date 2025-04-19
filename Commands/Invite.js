const { SlashCommandBuilder } = require('@discordjs/builders');
const { COLOR } = require('../Utils/Constants');

const invite = 'https://discord.com/oauth2/authorize?client_id=1065103018212732938&permissions=137439267848&integration_type=0&scope=bot';

const embed = {
	color: COLOR.PRIMARY,
	description: `
**Mission Status : Secured**
Your server is now monitored and secure.
Deploy FBI to serve and protect:
https://notfbi.dev/invite

-# This message will self-destruct in 5 seconds ...
`
}

module.exports = {
	bypass: true,
	data: new SlashCommandBuilder()
		.setName('invite')
		.setDescription('Invite the bot to your server'),
	execute: async function(interaction, client) {
		await interaction.reply({
			embeds: [embed],
			ephemeral: true
		}).catch(() => {});
	}
}