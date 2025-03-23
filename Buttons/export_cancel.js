const { COLOR } = require("../Utils/Constants");

const ConfirmEmbed = {
	color: COLOR.ERROR,
	description: 'Are you sure you want to cancel the export?'
}

const ConfirmButtons = {
	type: 1,
	components: [
		{
			type: 2,
			style: 4,
			label: 'Delete',
			custom_id: 'export-cancel_confirm',
			emoji: '🗑️'
		},
		{
			type: 2,
			style: 3,
			label: 'Take me back!',
			custom_id: 'export-main'
		}
	]
}

module.exports = {
	customID: 'export-cancel',
	execute: async function(interaction, client, args) {
		const confirm = !!args[0];

		await interaction.deferUpdate().catch(() => {});

		if (!confirm) {
			await interaction.editReply({ embeds: [ConfirmEmbed], components: [ConfirmButtons] });
		} else {
			await interaction.deleteReply().catch(() => {});
		}
	}
}