const { SlashCommandBuilder } = require('@discordjs/builders');
const { COLOR } = require('../Utils/Constants');

const embed = {
	color: COLOR.PRIMARY,
	title: 'Fox Box Insurance : v2.1.0',
	description: `
Last updated: \`2025 May 7th\`

\\- Better error handling for failed messages

https://github.com/MusicMakerOwO/Virdeon/commits/main`
}

module.exports = {
	data: new SlashCommandBuilder()
		.setName('changelog')
		.setDescription('New here? Check out what has changed!'),
	execute: async function(interaction, client) {
		await interaction.reply({ embeds: [embed] });
	}
}