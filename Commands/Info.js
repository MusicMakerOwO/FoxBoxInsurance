const { SlashCommandBuilder } = require('@discordjs/builders');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('info')
		.setDescription('Display general bot information'),
	execute: async function(interaction, client) {
		const infoButton = client.buttons.get('bot-info');
		await infoButton.execute(interaction, client, []);
	}
}