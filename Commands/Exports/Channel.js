const { SlashCommandBuilder } = require('@discordjs/builders');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('channel')
		.setDescription('Manage channel access')
		.addChannelOption( x => x
			.setName('channel')
			.setDescription('The channel to manage')
			.setRequired(true)
		)
		.addBooleanOption( x => x
			.setName('disable_exports')
			.setDescription('Block exporting messages')
			.setRequired(true)
		),
	execute: async function(interaction, client) {
		const block = interaction.options.getBoolean('disable_exports');
		const targetCommand = client.commands.get( block ? 'disableexport' : 'enableexport' );
		await targetCommand.execute(interaction, client);
	}
}