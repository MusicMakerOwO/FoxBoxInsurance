const { bypass } = require("./tos_accept");

module.exports = {
	bypass: true,
	customID: 'close',
	execute: async function(interaction, client, args) {
		await interaction.deferUpdate().catch(() => {});
		await interaction.deleteReply().catch(() => {});
	}
}