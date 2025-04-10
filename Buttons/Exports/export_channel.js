const GetExportCache = require("../../Utils/Caching/GetExportCache")

const modal = {
	title: 'Export Channel',
	custom_id: 'export-channel',
	components: [{
		type: 1,
		components: [{
			type: 4,
			custom_id: 'data',
			label: 'Channel name or ID',
			style: 1,
			min_length: 1,
			max_length: 100,
			required: true
		}]
	}]
}

module.exports = {
	customID: 'export-channel',
	execute: async function(interaction, client, args) {
		const exportOptions = await GetExportCache(client, interaction);
		if (!exportOptions) return;

		await interaction.showModal(modal);
	}
}