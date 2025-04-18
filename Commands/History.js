const { SlashCommandBuilder } = require('@discordjs/builders');
const Database = require('../Utils/Database');
const { COLOR } = require('../Utils/Constants');

const NoExportsEmbed = {
	color: COLOR.ERROR,
	description: 'You have no export history - Use \`/export` to get started!'
}

module.exports = {
	data: new SlashCommandBuilder()
		.setName('history')
		.setDescription('View your recent export history'),
	execute: async function(interaction, client) {
		const count = Database.prepare(`SELECT COUNT(*) FROM Exports WHERE user_id = ?`).pluck().get(interaction.user.id);
		if (count === 0) {
			await interaction.reply({
				embeds: [NoExportsEmbed],
				ephemeral: true
			}).catch(() => {});
			return;
		}

		await interaction.deferReply({ ephemeral: true });
		interaction.deferUpdate = async () => {}

		const history = client.buttons.get('history');
		await history.execute(interaction, client, ['0']);
	}
}