const { ChannelType } = require("discord.js");
const GetExportCache = require("../Utils/Caching/GetExportCache");
const ClosestMatch = require("../Utils/ClosestMatch");
const { COLOR, SECONDS } = require("../Utils/Constants");
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

const channelCache = new TTLCache(); // guildID -> Map<channelName, channelID[]>

module.exports = {
	customID: 'export-channel',
	execute: async function(interaction, client, args) {

		const exportOptions = await GetExportCache(client, interaction);
		if (!exportOptions) return;

		const targetChannel = interaction.fields.getSelectedChannels('data').first();

		if (
			!interaction.member.permissions.has('Administrator') &&
			!targetChannel.permissionsFor(interaction.member).has('ViewChannel')
		) {
			return interaction.reply({ embeds: [UnknownChannelEmbed], flags: 64 });
		}

		if (!ALLOWED_CHANNEL_TYPES.includes(targetChannel.type)) {
			return interaction.reply({ embeds: [IncompatibleChannelEmbed], flags: 64 });
		}

		if ( ! await UserCanExport(interaction.member, targetChannel.id)) {
			return interaction.reply({ embeds: [NoExport], flags: 64 });
		}

		const [{ count: channelMessageCount }] = await Database.query('SELECT COUNT(*) as count FROM Messages WHERE channel_id = ?', [targetChannel.id]);

		exportOptions.channelID = targetChannel.id;
		exportOptions.messageCount = Math.min(Number(channelMessageCount), 100);
		exportOptions.lastMessageID = String( (BigInt(Date.now() - 1420070400000) << 22n) | BigInt(0b1_1111_11111111_11111111) );

		client.ttlcache.set(
			`export_${interaction.guildId}_${interaction.channelId}_${interaction.user.id}`,
			exportOptions
		);

		const main = client.buttons.get('export-main');
		return main.execute(interaction, client, []);
	}
}