const { COLOR, EMOJI } = require("../../Utils/Constants");

module.exports = {
	customID: 'import',
	execute: async function(interaction, client, args) {
		const importID = args[0];

		await interaction.deferUpdate({ ephemeral: true }).catch(() => { });

		const embed = {
			color: COLOR.PRIMARY,
			title: 'Import Snapshot?',
			description: `
__Snapshot can contain harmful data__ like admin roles or broken permissions!
Make sure you trust the person who created it

**Messages are never included in snapshots!**
This snapshot will be removed from your list after 60 minutes`
		}

		const manageButtons = {
			type: 1,
			components: [
				{
					type: 2,
					style: 2,
					label: 'View',
					custom_id: `import-view_${importID}`,
					emoji: EMOJI.SEARCH
				},
				{
					type: 2,
					style: 4,
					label: 'Cancel',
					custom_id: 'close',
					emoji: EMOJI.DELETE
				},
				{
					type: 2,
					style: 3,
					label: 'Import',
					custom_id: `import-confirm_${importID}`,
					emoji: EMOJI.IMPORT
				}
			]
		}

		return interaction.editReply({
			embeds: [embed],
			components: [manageButtons]
		});
	}
}