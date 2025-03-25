const GetExportCache = require("../Utils/Caching/GetExportCache");
const TimedCache = require("../Utils/Caching/TimedCache");
const ClosestMatch = require("../Utils/ClosestMatch");
const { COLOR } = require("../Utils/Constants");
const Database = require("../Utils/Database");

const REGEX_ID = /^\d{17,}$/;

const UnknownChannelEmbed = {
	color: COLOR.ERROR,
	description: 'Unknown channel - Please check the name or ID and try again'
}

const channelCache = new TimedCache(1000 * 60 * 5); // guildID -> { channelName : channelID }

module.exports = {
	customID: 'export-channel',
	execute: async function(interaction, client, args) {

		const exportOptions = await GetExportCache(client, interaction);
		if (!exportOptions) return;

		const input = interaction.fields.getTextInputValue('data');

		let targetID = '';

		const isID = REGEX_ID.test(input);
		if (isID) {
			// check the id exists in the database
			const channel = Database.prepare('SELECT id FROM channels WHERE id = ? AND guild_id = ?').pluck().get(input, interaction.guild.id);
			if (channel) {
				targetID = channel.id;
			} else {
				// check if the channel exists in the guild
				const channel = interaction.guild.channels.cache.get(input);
				if (channel) {
					targetID = channel.id;
				} else {
					await interaction.reply({ embeds: [UnknownChannelEmbed], ephemeral: true });
					return;
				}
			}
		} else {
			if (!channelCache.has(interaction.guild.id)) {
				channelCache.set(interaction.guild.id, Object.fromEntries(interaction.guild.channels.cache.map(c => [c.name, c.id])));
			}

			const channelList = channelCache.get(interaction.guild.id);

			if (input in channelList) {
				targetID = channelList[input];
			} else {
				// fuzzy search for closet channel name
				const match = ClosestMatch(input, Object.keys(channelList));
				targetID = channelList[match];
			}
		}

		const targetChannel = interaction.guild.channels.cache.get(targetID);

		const hasAdmin = interaction.member.permissions.has('Administrator');
		const canAccess = hasAdmin || targetChannel?.permissionsFor(interaction.member).has('ViewChannel');

		if (
			interaction.member.permissions.has('Administrator') ||
			targetChannel?.permissionsFor(interaction.member).has('ViewChannel')
		) {
			await interaction.reply({ embeds: [UnknownChannelEmbed], ephemeral: true });
			return;
		}

		exportOptions.channelID = targetID;

		client.timedCache.set(`export_${interaction.guildId}_${interaction.channelId}_${interaction.user.id}`, exportOptions);

		const main = client.buttons.get('export-main');
		await main.execute(interaction, client, []);
	}
}