import {CommandHandler} from "../../Typings/HandlerTypes.js";
import {SlashCommandBuilder} from "discord.js";
import {COLOR, EMOJI} from "../../Utils/Constants.js";
import {UnblockUser} from "../../Services/ExportAccess.js";
import { TOS_FEATURES } from "../../TOSConstants.js";
import { GUILD_FEATURES } from "../../Typings/DatabaseTypes.js";
import { DiscordPermissions } from "../../Utils/DiscordConstants.js";

export default {
	tos_features  : [ TOS_FEATURES.MESSAGE_EXPORTS ],
	guild_features: [ GUILD_FEATURES.EXPORT_MESSAGES ],
	permissions   : [ DiscordPermissions.Administrator ],
	response_type : 'reply',
	hidden        : true,
	usage         : '/enableuser <@user>',
	examples      : [
		'/enableuser @user',
		'/enableuser 123456789012345678'
	],
	aliases       : ['unblockuser'],
	data          : new SlashCommandBuilder()
		.setName('enableuser')
		.setDescription('Allow a user to use exports')
		.addUserOption( x => x
			.setName('user')
			.setDescription('The user to unblock')
			.setRequired(true)
		),
	execute: async function(interaction) {

		const user = interaction.options.getUser('user')!;
		await UnblockUser(interaction.guildId!, user.id);

		return {
			embeds: [{
				color: COLOR.SUCCESS,
				description: `
**Status**: ${EMOJI.SUCCESS} Unblocked 
<@${user.id}> can now export messages in this server`
			}]
		}
	}
} satisfies CommandHandler as CommandHandler;