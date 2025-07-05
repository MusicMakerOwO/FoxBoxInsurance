const { SlashCommandBuilder } = require('@discordjs/builders');
const { COLOR } = require('../Utils/Constants');

const embed = {
	color: COLOR.PRIMARY,
	description: `
Thank you for using FBI - We are dedicated to providing free and safe moderation for all.
If you'd like to support us, consider voting for us on top.gg ❤️

https://top.gg/bot/1065103018212732938`
}

const button = {
	type: 1,
	components: [{
		type: 2,
		style: 5,
		label: 'Open Top.gg',
		url: 'https://top.gg/bot/1065103018212732938/vote'
	}]
}

module.exports = {
	data: new SlashCommandBuilder()
		.setName('vote')
		.setDescription('Help FBI by voting for us'),
	execute: async function(interaction, client) {
		interaction.reply({
			embeds: [embed],
			components: [button]
		});
	}
}