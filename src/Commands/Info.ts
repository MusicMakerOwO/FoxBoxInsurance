import {CommandHandler} from "../Typings/HandlerTypes";
import {ButtonInteraction, SlashCommandBuilder} from "discord.js";

export default {
	tos_features  : [],
	guild_features: [],
	permissions   : [],
	response_type : 'reply',
	hidden        : true,
	aliases       : ['stats', 'botinfo'],
	data          : new SlashCommandBuilder()
		.setName('info')
		.setDescription('Display general bot information'),
	execute       : async function(interaction, client) {
		const infoButton = client.buttons.get('bot-info')!;
		return infoButton.execute(interaction as unknown as ButtonInteraction, client, []);
	}
} satisfies CommandHandler as CommandHandler;