import {CommandHandler} from "../Typings/HandlerTypes";
import {COLOR} from "../Utils/Constants";
import {SlashCommandBuilder} from "discord.js";

const embed = {
	color: COLOR.PRIMARY,
	description: `
Thank you for using Fox Box Insurance <3
This has always been a huge passion project and it means a lot to me.

https://notfbi.dev/invite`
}

export default {
	tos_features  : [],
	guild_features: [],
	permissions   : [],
	response_type : 'reply',
	hidden        : false,
	data          : new SlashCommandBuilder()
		.setName('invite')
		.setDescription('Invite the bot to your server'),
	execute       : async function() {
		return { embeds: [embed] };
	}
} satisfies CommandHandler as CommandHandler;