import {ButtonInteraction, SlashCommandBuilder} from "discord.js";
import {CommandHandler} from "../Typings/HandlerTypes";

export default {
	tos_features  : [],
	guild_features: [],
	permissions   : [],
	response_type : 'reply',
	hidden        : true,
	data          : new SlashCommandBuilder()
		.setName('history')
		.setDescription('View your recent export history'),
	execute       : async function(interaction, client) {
		const history = client.buttons.get('history')!;
		return history.execute(interaction as unknown as ButtonInteraction, client, ['0']);
	}
} satisfies CommandHandler as CommandHandler;