import {CommandHandler} from "../../Typings/HandlerTypes.js";
import {SlashCommandBuilder} from "discord.js";
import {COLOR, EMOJI} from "../../Utils/Constants.js";
import {SetChannelExportStatus} from "../../Services/ExportAccess.js";
import { TOS_FEATURES } from "../../TOSConstants.js";
import { GUILD_FEATURES } from "../../Typings/DatabaseTypes.js";
import { DiscordPermissions } from "../../Utils/DiscordConstants.js";

export default {
	tos_features  : [ TOS_FEATURES.MESSAGE_EXPORTS ],
	guild_features: [ GUILD_FEATURES.EXPORT_MESSAGES ],
	permissions   : [ DiscordPermissions.Administrator ],
	response_type : 'reply',
	hidden        : true,
	usage         : '/disablechannel <#channel>',
	examples      : [
		'/disablechannel #general',
		'/disablechannel 123456789012345678'
	],
	aliases       : ['blockchannel'],
	data          : new SlashCommandBuilder()
		.setName('disablechannel')
		.setDescription('Disable exports in a channel - Only server admins can bypass this')
		.addChannelOption(x => x
			.setName('channel')
			.setDescription('The channel to disable exports in')
			.setRequired(true)
		),
	execute: async function(interaction) {

		const channel = interaction.options.getChannel('channel')!;
		await SetChannelExportStatus(channel.id, false);

		return {
			embeds: [{
				color: COLOR.PRIMARY,
				description: `
**Exports have been disabled** ${EMOJI.ERROR}
Only server admins are allowed to bypass this`
			}]
		}
	}
} satisfies CommandHandler as CommandHandler;