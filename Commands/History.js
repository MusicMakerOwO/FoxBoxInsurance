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
		const count = await Database.query(`SELECT COUNT(*) as count FROM Exports WHERE user_id = ?`, [interaction.user.id]).then(res => res[0]?.count);
		if (count === 0n) {
			return interaction.reply({
				embeds: [NoExportsEmbed],
				flags: 64
			});
		}

		await interaction.deferReply({ flags: 64 });

		const history = client.buttons.get('history');
		return history.execute(interaction, client, ['0']);
	}
}