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

		const connection = await Database.getConnection();

		const exportID = interaction.values[0];
		const [exportData] = await connection.query(`SELECT * FROM Exports WHERE id = ?`, [exportID]);
		if (!exportData) {
			Database.releaseConnection(connection);
			return interaction.editReply({ embeds: [NoExportEmbed], components: [] });
		}

		const guild = await connection.query(`SELECT name FROM Guilds WHERE id = ?`, [exportData.guild_id]).then(res => res[0]?.name || 'Unknown Guild');
		const channel = await connection.query(`SELECT name FROM Channels WHERE id = ?`, [exportData.channel_id]).then(res => res[0]?.name || 'Unknown Channel');

		Database.releaseConnection(connection);

		const embed = {
			color: COLOR.PRIMARY,
			description: `
**Export ID:** ${exportData.id}

**Guild** : ${guild} (${exportData.guild_id})
**Channel** : #${channel} (${exportData.channel_id})

**Messages** : ${exportData.message_count}
**Format** : ${FORMAT[exportData.format] || 'Unknown'}

**Created At** : <t:${Math.floor(new Date(exportData.created_at * 1000).getTime() / 1000)}:f>`
		}

		interaction.editReply({ embeds: [embed], components: [] });
	}
}