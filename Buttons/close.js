module.exports = {
	allow_dm: true,
	bypass: true,
	customID: 'close',
	execute: async function(interaction, client, args) {
		await interaction.deferUpdate().catch(() => {});
		await interaction.deleteReply().catch(() => {});
	}
}