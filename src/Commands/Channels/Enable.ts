import {CommandHandler} from "../../Typings/HandlerTypes";
import {SlashCommandBuilder} from "discord.js";
import {COLOR, EMOJI} from "../../Utils/Constants";
import {SetChannelExportStatus} from "../../Services/ExportAccess";
import { TOS_FEATURES } from "../../TOSConstants";
import { GUILD_FEATURES } from "../../Typings/DatabaseTypes";
import { DiscordPermissions } from "../../Utils/DiscordConstants";

export default {
	tos_features  : [ TOS_FEATURES.MESSAGE_EXPORTS ],
	guild_features: [ GUILD_FEATURES.EXPORT_MESSAGES ],
	permissions   : [ DiscordPermissions.Administrator ],
	response_type : 'reply',
	hidden        : true,
	usage         : '/enablechannel <#channel>',
	examples      : [
		'/enablechannel #general',
		'/enablechannel 123456789012345678'
	],
	aliases       : ['unblockchannel'],
	data          : new SlashCommandBuilder()
		.setName('enablechannel')
		.setDescription('Enable exports in a channel - Only server admins can bypass this')
		.addChannelOption(x => x
			.setName('channel')
			.setDescription('The channel to enable exports in')
			.setRequired(true)
		),
	execute: async function(interaction) {

		const channel = interaction.options.getChannel('channel')!;
		await SetChannelExportStatus(channel.id, true);

		return {
			embeds: [{
				color: COLOR.PRIMARY,
				description: `
**Exports have been enabled** ${EMOJI.SUCCESS}
Anyone who can see the channel can export messages from it`
			}]
		}
	}
} satisfies CommandHandler as CommandHandler;