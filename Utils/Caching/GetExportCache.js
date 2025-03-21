const { COLOR } = require("../Constants");

const NoDataEmbed = {
	color: COLOR.ERROR,
	description: 'Your session has timed out - Please re-run the command'
}

module.exports = async function GetExportCache(client, interaction) {
	const cacheKey = `export_${interaction.guildId}_${interaction.channelId}_${interaction.user.id}`;
	const exportOptions = client.timedCache.get(cacheKey);
	if (!exportOptions) {
		if (interaction.deferred || interaction.replied) {
			await interaction.editReply({ embeds: [NoDataEmbed] });
		} else {
			await interaction.update({ embeds: [NoDataEmbed] });
		}
		return null;
	} else {
		return exportOptions;
	}
}