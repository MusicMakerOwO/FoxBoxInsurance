module.exports = {
	customID: 'restore-confirm',
	execute: async function (interaction, client, args) {
		// spawn a modal, user must type the server name to confirm
		const modal = {
			custom_id: `restore-confirm_${args[0]}`,
			title: 'Confirmation',
			components: [{
				type: 1,
				components: [{
					type: 4,
					custom_id: 'data',
					label: 'Type the server name to confirm',
					placeholder: interaction.guild.name,
					style: 1
				}]
			}]
		}

		interaction.showModal(modal);
	}
}