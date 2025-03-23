const GetExportCache = require("../Utils/Caching/GetExportCache");
const Database = require("../Utils/Database");

module.exports = {
	customID: 'export-messages',
	execute: async function(interaction, client, args) {

		const input = interaction.fields.getTextInputValue('data');

		const cleanInput = input.replace(/\D/g, ''); // 10,000 -> 10000
		const inputNumber = Math.max(20, Math.min(10_000, parseInt(cleanInput))); // [1, 10_000]

		const exportOptions = await GetExportCache(client, interaction);
		if (!exportOptions) return;

		const channelMessageCount = Database.prepare('SELECT COUNT(*) FROM Messages WHERE channel_id = ?').pluck().get(exportOptions.channelID);

		exportOptions.messageCount = Math.min(inputNumber, channelMessageCount);

		client.timedCache.set(`export_${interaction.guildId}_${interaction.channelId}_${interaction.user.id}`, exportOptions);

		const main = client.buttons.get('export-main');
		await main.execute(interaction, client, []);
	}
}