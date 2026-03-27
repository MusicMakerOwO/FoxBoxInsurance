import {ButtonHandler} from "../../Typings/HandlerTypes";
import {GetExportCache} from "../../Utils/Caching/GetExportCache";
import {Database} from "../../Database";
import { COLOR, EMOJI, FORMAT_EMOJIS, FORMAT_NAMES } from "../../Utils/Constants";
import { TOS_FEATURES } from "../../TOSConstants";
import { GUILD_FEATURES } from "../../Typings/DatabaseTypes";

export default {
	tos_features  : [ TOS_FEATURES.MESSAGE_EXPORTS ],
	guild_features: [ GUILD_FEATURES.EXPORT_MESSAGES ],
	permissions   : [],
	response_type : 'update',
	hidden        : false,
	customID      : 'export-main',
	execute       : async function(interaction) {
		// @ts-expect-error
		const exportOptions = await GetExportCache(interaction);
		if (!exportOptions) return {};

		const channel = interaction.guild!.channels.cache.get(exportOptions.channelID.toString());
		const channelName = channel
			? '<#' + channel.id + '>'
			: await Database.query("SELECT CONCAT('#', name) as name FROM Channels WHERE id = ?", [exportOptions.channelID]).then(res => res[0]?.name)
				?? 'Unknown Channel';

		const embed = {
			title: 'Export Options',
			color: COLOR.PRIMARY,
			description: `
Channel: ${channelName}
Format: ${FORMAT_EMOJIS[exportOptions.format]} ${FORMAT_NAMES[exportOptions.format]}
Messages: ${exportOptions.messageCount}`
		}

		return {
			embeds: [embed],
			components: [
				{
					type: 1,
					components: [
						{
							type: 2,
							style: 2,
							label: 'Channel',
							custom_id: 'export-channel',
							emoji: { name: '📢' }
						},
						{
							type: 2,
							style: 2,
							label: 'Format',
							custom_id: 'export-format',
							emoji: { name: '📁' }
						},
						{
							type: 2,
							style: 2,
							label: 'Messages',
							custom_id: 'export-messages',
							emoji: { name: '📝' }
						}
					]
				},
				{
					type: 1,
					components: [
						{
							type: 2,
							style: 3,
							label: 'Export',
							custom_id: 'export-finish',
							emoji: { name: '📎' },
							disabled: exportOptions.messageCount < 1
						},
						{
							type: 2,
							style: 4,
							label: 'Cancel',
							custom_id: 'export-cancel',
							emoji: { name: EMOJI.DELETE }
						}
					]
				}
			]
		}
	}
} satisfies ButtonHandler as ButtonHandler;