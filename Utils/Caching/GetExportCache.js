const { COLOR } = require("../Constants");

const NoDataEmbed = {
	color: COLOR.ERROR,
	description: 'Your session has timed out - Please re-run the command'
}

module.exports = async function GetExportCache(client, interaction) {
	const cacheKey = `export_${interaction.guildId}_${interaction.channelId}_${interaction.user.id}`;
	const exportOptions = client.ttlcache.get(cacheKey);
	if (!exportOptions) {
		if (!interaction.deferred && !interaction.replied) {
			await interaction.deferUpdate({ ephemeral: true });
		}
		await interaction.editReply({ embeds: [NoDataEmbed], components: [], files: [] });
		setTimeout(async () => {
			await interaction.deleteReply().catch(() => {});
		}, 7_000);
		return null;
	} else {
		return exportOptions;
	}
}