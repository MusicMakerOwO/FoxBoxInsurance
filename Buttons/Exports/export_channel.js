const GetExportCache = require("../../Utils/Caching/GetExportCache")

const modal = {
	title: 'Export Channel',
	custom_id: 'export-channel',
	components: [{
		type: 18,
		label: 'Select the channel to export from',
		component: {
			type: 8,
			custom_id: 'data',
			max_vales: 1,
			required: true
		}
	}]
}

module.exports = {
	customID: 'export-channel',
	execute: async function(interaction, client, args) {
		const exportOptions = await GetExportCache(client, interaction);
		if (!exportOptions) return;

		interaction.showModal(modal);
	}
}