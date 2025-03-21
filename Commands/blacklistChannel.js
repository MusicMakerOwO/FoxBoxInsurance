const { SlashCommandBuilder } = require('@discordjs/builders');
const Database = require('../Utils/Database');
const { BlacklistedChannels } = require('../Utils/Checks/ChannelCanExport');

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
			.setName('block_exports')
			.setDescription('Block exporting messages')
			.setRequired(true)
		),
	autocomplete: async function(interaction, client) {
		// this is optional, called on any autocomplete stuff
	},
	execute: async function(interaction, client) {
		const channel = interaction.options.getChannel('channel');
		const block = interaction.options.getBoolean('block_exports');

		Database.prepare(`
			INSERT INTO Channels (id, guild_id, name, type, block_exports)
			VALUES (?, ?, ?, ?, ?)
			ON CONFLICT (id) DO UPDATE SET block_exports = excluded.block_exports;
		`).run(channel.id, channel.guild.id, channel.name, channel.type, +block);

		if (block) {
			BlacklistedChannels.add(channel.id);
		} else {
			BlacklistedChannels.delete(channel.id);
		}

		interaction.reply({
			content: `Channel ${channel.name} (${channel.id}) has been ${block ? 'blacklisted' : 'whitelisted'}`,
			ephemeral: true
		});
	}
}