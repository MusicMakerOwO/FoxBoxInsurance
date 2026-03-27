import {ButtonInteraction, ChannelType, GuildChannel, GuildMember} from "discord.js";
import {COLOR} from "../Utils/Constants";
import {GetExportCache} from "../Utils/Caching/GetExportCache";
import {Database} from "../Database";
import {CanMemberExportChannel} from "../Services/ExportAccess";
import {InteractionResponse, ModalHandler} from "../Typings/HandlerTypes";
import {CreateExportCacheKey} from "../Typings/CacheEntries";
import {TOS_FEATURES} from "../TOSConstants";
import { GUILD_FEATURES } from "../Typings/DatabaseTypes";

const UnknownChannelEmbed = {
	color: COLOR.ERROR,
	description: 'Unknown channel - Please check the name or ID and try again'
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
const ALLOWED_CHANNEL_TYPES = new Set([
	ChannelType.GuildText,
	ChannelType.GuildVoice,
	ChannelType.GuildAnnouncement,
	ChannelType.AnnouncementThread,
	ChannelType.PublicThread,
	ChannelType.GuildStageVoice,
	ChannelType.GuildMedia
])

export default {
	tos_features  : [ TOS_FEATURES.MESSAGE_EXPORTS ],
	guild_features: [ GUILD_FEATURES.EXPORT_MESSAGES ],
	permissions   : [],
	response_type : 'update',
	hidden        : false,
	customID      : 'export-channel',
	execute       : async function(interaction, client) {

		// @ts-expect-error
		const exportOptions = await GetExportCache(interaction);
		if (!exportOptions) return {};

		const targetChannel = interaction.fields.getSelectedChannels('data')!.first() as GuildChannel;

		if (
			!(interaction.member as GuildMember).permissions.has('Administrator') &&
			!targetChannel.permissionsFor(interaction.member as GuildMember).has('ViewChannel')
		) {
			return { embeds: [UnknownChannelEmbed] }
		}

		if (!ALLOWED_CHANNEL_TYPES.has(targetChannel.type)) {
			return { embeds: [IncompatibleChannelEmbed] }
		}

		if ( ! await CanMemberExportChannel(interaction.member as GuildMember, targetChannel.id)) {
			return { embeds: [NoExport] }
		}

		const channelMessageCount = await Database.query('SELECT COUNT(*) as count FROM Messages WHERE channel_id = ?', [targetChannel.id]).then(res => res[0].count) as bigint;

		exportOptions.channelID = BigInt(targetChannel.id);
		exportOptions.messageCount = Math.min(Number(channelMessageCount), 100);

		client.exportCache.set(
			CreateExportCacheKey(interaction.channelId!, interaction.user.id),
			exportOptions
		);

		const main = client.buttons.get('export-main')!;
		return await main.execute(interaction as unknown as ButtonInteraction, client, []) as InteractionResponse;
	}
} satisfies ModalHandler as ModalHandler;