const { RESTORE_OPTIONS, COLOR, SECONDS } = require("../Utils/Constants");

const AVAILABLE_OPTIONS = new Set( Object.values(RESTORE_OPTIONS) );

const TimedOutEmbed = {
	color: COLOR.ERROR,
	title: 'Timed Out',
	description: 'Your session has timed out, please try again'
}

module.exports = {
	customID: 'restore-options',
	execute: async function(interaction, client, args) {
		const inputs = interaction.values.map(x => parseInt(x)); // number[]

		const currentOptions = client.ttlcache.get(`restore-options-${interaction.guild.id}`);
		if (!currentOptions) {
			return interaction.update({
				embeds: [ TimedOutEmbed ],
				components: []
			});
		}

		let newOptions = 0;
		for (let i = 0; i < inputs.length; i++) {
			if (isNaN(inputs[i]) || !AVAILABLE_OPTIONS.has(inputs[i])) {
				throw new Error(`Invalid restore option provided: ${interaction.values[i]} -> ${inputs[i]}`);
			}
			newOptions |= inputs[i];
		}

		client.ttlcache.set(`restore-options-${interaction.guild.id}`, newOptions, SECONDS.MINUTE * 10 * 1000);

		const optionsMenu = client.buttons.get('restore-options');
		return optionsMenu.execute(interaction, client, args);
	}
}