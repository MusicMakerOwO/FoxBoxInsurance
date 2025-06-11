const GetExportCache = require("../../Utils/Caching/GetExportCache");
const { COLOR, FORMAT, EMOJI } = require("../../Utils/Constants");
const Database = require("../../Utils/Database");

const optionButtons = {
	type: 1,
	components: [
		{
			type: 2,
			style: 2,
			label: 'Channel',
			custom_id: 'export-channel',
			emoji: '📢'
		},
		{
			type: 2,
			style: 2,
			label: 'Format',
			custom_id: 'export-format',
			emoji: '📁'
		},
		{
			type: 2,
			style: 2,
			label: 'Messages',
			custom_id: 'export-messages',
			emoji: '📝'
		}
	]
}

module.exports = {
	customID: 'export-main',
	execute: async function(interaction, client, args) {

		await interaction.deferUpdate?.().catch(() => {});

		/*
		const exportOptions = {
			guildID: interaction.guild.id,
			channelID: interaction.channel.id,
			userID: interaction.user.id,
			format: FORMAT.TEXT,
			messageCount: 100,
			options: { ... DEFAULT_OPTIONS }, // we have to clone the object so we don't modify the original
			lastMessageID: (BigInt(Date.now() - DISCORD_EPOCH_OFFSET) << 22n) | DISCORD_ID_FILLING
		}
		*/
		const exportOptions = await GetExportCache(client, interaction);
		if (!exportOptions) return;

		const channel = interaction.guild.channels.cache.get(exportOptions.channelID);
		const channelName = channel
			? '<#' + channel.id + '>'
			: Database.prepare("SELECT '#' || name FROM Channels WHERE id = ?").pluck().get(exportOptions.channelID)
				?? 'Unknown Channel';

		const embed = {
			title: 'Export Options',
			color: COLOR.PRIMARY,
			description: `
Channel: ${channelName}
Format: ${FORMAT[exportOptions.format]}
Messages: ${exportOptions.messageCount}`
		}

		const exportButtons = {
			type: 1,
			components: [
				{
					type: 2,
					style: 3,
					label: 'Export',
					custom_id: 'export-finish',
					emoji: '📎',
					disabled: exportOptions.messageCount < 1
				},
				{
					type: 2,
					style: 4,
					label: 'Cancel',
					custom_id: 'export-cancel',
					emoji: EMOJI.DELETE
				}
			]
		};

		await interaction.editReply({ embeds: [embed], components: [optionButtons, exportButtons] });
	}
}