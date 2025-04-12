const { SlashCommandBuilder } = require('@discordjs/builders');
const Database = require('../../Utils/Database');
const { BlacklistedChannels } = require('../../Utils/Checks/ChannelCanExport');
const { COLOR } = require('../../Utils/Constants');

const DisabledEmbed = {
	color: COLOR.ERROR,
	description: `
**Exports have been disabled**
Only server admins are allowed to bypass this`
}
const EnabledEmbed = {
	color: COLOR.SUCCESS,
	description: `
**Exports have been enabled**
Anyone who can see the channel can export messages from it`
}
const PermissionsEmbed = {
	color: COLOR.ERROR,
	description: `
**You do not have permission to use this command**
Only server admins are allowed to set this up`
}

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
		
		if (!interaction.member.permissions.has('Administrator')) {
			await interaction.reply({
				embeds: [PermissionsEmbed],
				ephemeral: true
			}).catch(() => {});
			return;
		}

		const channel = interaction.options.getChannel('channel');
		const block = interaction.options.getBoolean('disable_exports');

		Database.prepare(`
			INSERT INTO Channels (id, guild_id, name, type, block_exports)
			VALUES (?, ?, ?, ?, ?)
			ON CONFLICT (id) DO UPDATE SET block_exports = excluded.block_exports;
		`).run(channel.id, channel.guild.id, channel.name, channel.type, +block);

		let embed;
		if (block) {
			embed = DisabledEmbed;
			BlacklistedChannels.add(channel.id);
		} else {
			embed = EnabledEmbed;
			BlacklistedChannels.delete(channel.id);
		}

		await interaction.reply({
			embeds: [embed],
			ephemeral: true
		}).catch(() => {});
	}
}