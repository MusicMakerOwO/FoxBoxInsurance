const { SlashCommandBuilder } = require('@discordjs/builders');
const Database = require('../../Utils/Database');
const { COLOR } = require('../../Utils/Constants');
const { BlacklistedChannels } = require('../../Utils/Checks/ChannelCanExport');

const Embed = {
	color: COLOR.PRIMARY,
	description: `
**Exports have been disabled** ❌
Only server admins are allowed to bypass this`
}

const PermissionsEmbed = {
	color: COLOR.ERROR,
	description: `
**You do not have permission to use this command**
Only server admins are allowed to set this up`
}

module.exports = {
	usage: '/disablechannel <#channel>',
	examples: [
		'/disablechannel #general',
		'/disablechannel 123456789012345678'
	],
	data: new SlashCommandBuilder()
		.setName('disablechannel')
		.setDescription('Disable exports in a channel - Only server admins can bypass this')
		.addChannelOption(x => x
			.setName('channel')
			.setDescription('The channel to disable exports in')
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
		`).run(channel.id, channel.guild.id, channel.name, channel.type, 1);

		BlacklistedChannels.add(channel.id);

		await interaction.reply({
			embeds: [Embed],
			ephemeral: true
		}).catch(() => {});
	}
}