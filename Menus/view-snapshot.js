module.exports = {
	customID: 'snapshot-view',
	execute: async function(interaction, client, args) {
		const snapshotID = interaction.values[0];
		const button = client.buttons.get('snapshot-manage');
		button.execute(interaction, client, [snapshotID]);
	}
}