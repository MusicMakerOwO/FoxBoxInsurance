const { SlashCommandBuilder } = require('@discordjs/builders');
const { COLOR } = require('../Utils/Constants');

const embed = {
	color: COLOR.PRIMARY,
	title: 'Fox Box Insurance : v2.0.1',
	description: `
Last updated: \`2025 May 3rd\`

\\- This command lol
\\- Minor bug fixes
\\- Edge case for default avatars
\\- Made some commands publically visible

https://github.com/MusicMakerOwO/Virdeon/commits/main/`
}

module.exports = {
	data: new SlashCommandBuilder()
		.setName('changelog')
		.setDescription('New here? Check out what has changed!'),
	execute: async function(interaction, client) {
		await interaction.reply({ embeds: [embed] });
	}
}