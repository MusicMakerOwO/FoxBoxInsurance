const GetExportCache = require("../../Utils/Caching/GetExportCache")

const modal = {
	title: 'Export Messages',
	custom_id: 'export-messages',
	components: [{
		type: 1,
		components: [{
			type: 4,
			custom_id: 'data',
			label: 'How many messages to export?',
			placeholder: 'Enter a number between 1 and 10,000',
			style: 1,
			min_length: 1,
			max_length: 6,
			required: true
		}]
	}]
}

module.exports = {
	customID: 'export-messages',
	execute: async function(interaction, client, args) {
		const exportOptions = await GetExportCache(client, interaction);
		if (!exportOptions) return;

		await interaction.showModal(modal);
	}
}