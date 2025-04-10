const { COLOR, FORMAT } = require("../Utils/Constants");
const Database = require("../Utils/Database");

const NoExportEmbed = {
	color: COLOR.ERROR,
	description: 'No export found with that ID'
}

module.exports = {
	customID: 'exportInfo',
	execute: async function(interaction, client, args) {
		await interaction.deferReply({ ephemeral: true }).catch(() => {});

		const exportID = interaction.values[0];
		const exportData = Database.prepare(`SELECT * FROM Exports WHERE id = ?`).get(exportID);
		if (!exportData) {
			await interaction.editReply({ embeds: [NoExportEmbed], components: [] }).catch(() => {});
			return;
		}

		const guild = Database.prepare(`SELECT name FROM Guilds WHERE id = ?`).pluck().get(exportData.guild_id);
		const channel = Database.prepare(`SELECT name FROM Channels WHERE id = ?`).pluck().get(exportData.channel_id);

		const embed = {
			color: COLOR.PRIMARY,
			description: `
**Export ID:** ${exportData.id}

**Guild** : ${guild} (${exportData.guild_id})
**Channel** : #${channel} (${exportData.channel_id})

**Messages** : ${exportData.message_count}
**Format** : ${FORMAT[exportData.format] || 'Unknown'}

**Created At** : <t:${Math.floor(new Date(exportData.created_at).getTime() / 1000)}:f>`
		}

		await interaction.editReply({ embeds: [embed], components: [] }).catch(() => {});
	}
}