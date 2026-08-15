import {COLOR} from "../../Utils/Constants.js";
import {SlashCommandBuilder} from "discord.js";
import {BlockUserFromExport} from "../../Services/ExportAccess.js";
import {CommandHandler} from "../../Typings/HandlerTypes.js";
import { TOS_FEATURES } from "../../TOSConstants.js";
import { GUILD_FEATURES } from "../../Typings/DatabaseTypes.js";
import { DiscordPermissions } from "../../Utils/DiscordConstants.js";

export default {
	tos_features  : [ TOS_FEATURES.MESSAGE_EXPORTS ],
	guild_features: [ GUILD_FEATURES.EXPORT_MESSAGES ],
	permissions   : [ DiscordPermissions.Administrator ],
	response_type : 'reply',
	hidden        : true,
	usage         : '/disableuser <@user>',
	examples      : [
		'/disableuser @user',
		'/disableuser 123456789012345678'
	],
	aliases       : ['blockuser'],
	data          : new SlashCommandBuilder()
		.setName('disableuser')
		.setDescription('Block a user from using exports')
		.addUserOption( x => x
			.setName('user')
			.setDescription('The user to block')
			.setRequired(true)
		),
	execute: async function(interaction) {

		const user = interaction.options.getUser('user')!;
		await BlockUserFromExport(interaction.guildId!, user.id, interaction.user.id);

		return {
			embeds: [{
				color: COLOR.PRIMARY,
				description: `
**Status**: ❌ Blocked
<@${user.id}> can no longer export messages in this server`
			}]
		}
	}
} satisfies CommandHandler as CommandHandler;