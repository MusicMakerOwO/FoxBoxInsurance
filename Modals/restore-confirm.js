const { COLOR } = require("../Utils/Constants");

const WrongInputEmbed = {
	color: COLOR.ERROR,
	description: "Hmm that doesn't quite match...\nPlease type the server name to confirm the restore"
}

module.exports = {
	customID: 'restore-confirm',
	execute: async function(interaction, client, args) {
		const snapshotID = args[0];
		const input = interaction.fields.getTextInputValue('data');
		if (input !== interaction.guild.name) {
			return interaction.reply({
				embeds: [WrongInputEmbed],
				ephemeral: true
			});
		}

		const startButton = client.buttons.get('restore-start');
		startButton.execute(interaction, client, [snapshotID]);
	}
}