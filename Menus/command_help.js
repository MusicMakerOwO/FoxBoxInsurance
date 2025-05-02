module.exports = {
	customID: 'command-help',
	execute: async function(interaction, client, args) {
		const commandName = interaction.values[0];
		const helpCommand = client.commands.get('help');
		interaction.options = {
			getString: () => commandName
		}
		await helpCommand.execute(interaction, client);
	}
}