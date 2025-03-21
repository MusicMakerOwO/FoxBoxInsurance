const GetExportCache = require("../Utils/Caching/GetExportCache")

module.exports = {
	customID: 'export-main',
	execute: async function(interaction, client, args) {

		const exportOptions = await GetExportCache(client, interaction);
		if (!exportOptions) return;

	}
}