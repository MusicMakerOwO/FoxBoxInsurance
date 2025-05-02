const { SlashCommandBuilder } = require('@discordjs/builders');
const Database = require('../../Utils/Database');
const { COLOR } = require('../../Utils/Constants');
const { BlacklistedChannels } = require('../../Utils/Checks/ChannelCanExport');

const Embed = {
	color: COLOR.PRIMARY,
	description: `
**Exports have been enabled** ✅
Anyone who can see the channel can export messages from it`
}

const PermissionsEmbed = {
	color: COLOR.ERROR,
	description: `
**You do not have permission to use this command**
Only server admins are allowed to set this up`
}

module.exports = {
	usage: '/enablechannel <#channel>',
	examples: [
		'/enablechannel #general',
		'/enablechannel 123456789012345678'
	],
	data: new SlashCommandBuilder()
		.setName('enablechannel')
		.setDescription('Enable exports in a channel - Only server admins can bypass this')
		.addChannelOption(x => x
			.setName('channel')
			.setDescription('The channel to enable exports in')
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

		Database.prepare(`
			INSERT INTO Channels (id, guild_id, name, type, block_exports)
			VALUES (?, ?, ?, ?, ?)
			ON CONFLICT (id) DO UPDATE SET block_exports = excluded.block_exports;
		`).run(channel.id, channel.guild.id, channel.name, channel.type, 0);

		BlacklistedChannels.delete(channel.id);

		await interaction.reply({
			embeds: [Embed],
			ephemeral: true
		}).catch(() => {});
	}
}