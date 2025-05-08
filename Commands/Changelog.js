const { SlashCommandBuilder } = require('@discordjs/builders');
const { COLOR } = require('../Utils/Constants');

const embed = {
	color: COLOR.PRIMARY,
	title: 'Fox Box Insurance : v2.1.1',
	description: `
Last updated: \`2025 May 8th\`

\\- Database optimizations :>

https://github.com/MusicMakerOwO/FoxBoxInsurance/commits/main`
}

module.exports = {
	data: new SlashCommandBuilder()
		.setName('changelog')
		.setDescription('New here? Check out what has changed!'),
	execute: async function(interaction, client) {
		await interaction.reply({ embeds: [embed] });
	}
}