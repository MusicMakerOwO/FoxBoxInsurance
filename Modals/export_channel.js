const { ChannelType } = require("discord.js");
const GetExportCache = require("../Utils/Caching/GetExportCache");
const ClosestMatch = require("../Utils/ClosestMatch");
const { COLOR } = require("../Utils/Constants");
const Database = require("../Utils/Database");
const UserCanExport = require("../Utils/UserCanExport");
const TTLCache = require("../Utils/Caching/TTLCache");

const REGEX_ID = /^\d{17,}$/;

const UnknownChannelEmbed = {
	color: COLOR.ERROR,
	description: 'Unknown channel - Please check the name or ID and try again'
}

const MultipleChannelEmbed = {
	color: COLOR.ERROR,
	description: 'Multiple channels found with that name - Please specify the channel ID'
}

const IncompatibleChannelEmbed = {
	color: COLOR.ERROR,
	description: 'Cannot export this channel - Please select a text or voice channel'
}

const NoExport = {
	color: COLOR.ERROR,
	description: 'This channel cannot be exported - Please contact an admin'
}

// WHY ARE THERE SO MANY CHANNEL TYPES????
const ALLOWED_CHANNEL_TYPES = [
	ChannelType.GuildText,
	ChannelType.GuildVoice,
	ChannelType.GuildAnnouncement,
	ChannelType.AnnouncementThread,
	ChannelType.PublicThread,
	ChannelType.GuildStageVoice,
	ChannelType.GuildMedia
];

const channelCache = new TTLCache(); // guildID -> { channelName : channelID }

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
			const channel = Database.prepare('SELECT id FROM channels WHERE id = ? AND guild_id = ?').get(input, interaction.guild.id);
			if (channel) {
				targetID = channel.id;
			} else {
				// check if the channel exists in the guild
				const channel = interaction.guild.channels.cache.get(input) ?? Database.prepare('SELECT id FROM channels WHERE id = ?').get(input);
				if (channel) {
					targetID = channel.id;
				} else {
					return interaction.reply({ embeds: [UnknownChannelEmbed], ephemeral: true });
				}
			}
		} else {
			if (!channelCache.has(interaction.guild.id)) {
				// { id, name }[]
				const dbChannels = Database.prepare('SELECT id, name FROM channels WHERE guild_id = ?').all(interaction.guild.id);
				// [ id, name ][]
				const guildChannels = interaction.guild.channels.cache.map(c => [c.id, c.name]);

				const channelList = new Map(); // channelName -> channelID[] in case there are duplicate names
				for (const {id, name} of dbChannels) {
					if (channelList.has(name)) {
						channelList.get(name).add(id);
					} else {
						channelList.set(name, new Set([id]));
					}
				}

				for (const [id, name] of guildChannels) {
					if (channelList.has(name)) {
						channelList.get(name).add(id);
					} else {
						channelList.set(name, new Set([id]));
					}
				}

				// convert to array
				for (const [name, ids] of channelList) {
					channelList.set(name, Array.from(ids));
				}

				channelCache.set(interaction.guild.id, channelList, SECONDS.HOUR * 1000); // cache for 1 hour
			}

			const channelList = channelCache.get(interaction.guild.id);

			if (input in channelList) {
				// if multiple IDs are found, require the user to specify one
				if (channelList[input].length > 1) {
					return interaction.reply({ embeds: [MultipleChannelEmbed], ephemeral: true });
				} else {
					targetID = channelList[input][0];
				}
			} else {
				// fuzzy search for closet channel name
				const match = ClosestMatch(input, Array.from( channelList.keys() )); // channel name
				if (!match) throw new Error('Match not found');

				const selection = channelList.get(match); // id[]
				if (selection.length > 1) {
					return interaction.reply({ embeds: [MultipleChannelEmbed], ephemeral: true });
				} else {
					targetID = selection[0];
				}
			}
		}

		console.log(`Target ID: ${targetID}`);

		const targetChannel = interaction.guild.channels.cache.get(targetID);

		if (
			!interaction.member.permissions.has('Administrator') &&
			!(targetChannel?.permissionsFor(interaction.member).has('ViewChannel'))
		) {
			return interaction.reply({ embeds: [UnknownChannelEmbed], ephemeral: true });
		}

		const channelData = targetChannel ?? Database.prepare('SELECT type FROM channels WHERE id = ?').get(targetID);
		if (!channelData) {
			return interaction.reply({ embeds: [UnknownChannelEmbed], ephemeral: true });
		}
		if (!ALLOWED_CHANNEL_TYPES.includes(channelData.type)) {
			return interaction.reply({ embeds: [IncompatibleChannelEmbed], ephemeral: true });
		}

		if (!UserCanExport(interaction.member, targetID)) {
			return interaction.reply({ embeds: [NoExport], ephemeral: true });
		}
		
		const channelMessageCount = Database.prepare('SELECT COUNT(*) FROM messages WHERE channel_id = ?').pluck().get(targetID);
		
		exportOptions.channelID = targetID;
		exportOptions.messageCount = Math.min(channelMessageCount, 100);
		exportOptions.lastMessageID = String( (BigInt(Date.now() - 1420070400000) << 22n) | BigInt(0b1_1111_11111111_11111111) );
		
		client.ttlcache.set(
			`export_${interaction.guildId}_${interaction.channelId}_${interaction.user.id}`,
			exportOptions
		);

		const main = client.buttons.get('export-main');
		return main.execute(interaction, client, []);
	}
}