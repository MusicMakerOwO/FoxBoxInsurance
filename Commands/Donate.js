const { SlashCommandBuilder } = require('@discordjs/builders');
const { COLOR } = require('../Utils/Constants');

const embed = {
	color: COLOR.PRIMARY,
	description: `
Thank you for using FBI - We are dedicated to providing free and safe moderation for all. \
If you would like to support us, please consider donating to our ☕ Ko-fi page. \
__These donations will only go to server costs.__

**Current server costs** : $12.17/month`
}

// heart emoji: '❤️'
// coffee emoji: '☕'
const button = {
	type: 1,
	components: [{
		type: 2,
		style: 5,
		label: 'Donate ❤️',
		url: 'https://ko-fi.com/fbi'
	}]
}

module.exports = {
	bypass: true,
	data: new SlashCommandBuilder()
		.setName('donate')
		.setDescription('Show your support by helping us out!'),
	execute: async function(interaction, client) {
		await interaction.reply({
			embeds: [embed],
			components: [button],
			ephemeral: true
		}).catch(() => {});
	}
}