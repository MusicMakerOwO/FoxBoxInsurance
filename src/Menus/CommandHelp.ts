import {SelectMenuHandler} from "../Typings/HandlerTypes";
import {ChatInputCommandInteraction} from "discord.js";

export default {
	tos_features  : [],
	guild_features: [],
	permissions   : [],
	response_type : 'reply',
	hidden        : false,
	customID      : 'command-help',
	execute       : async function(interaction, client) {
		const commandName = interaction.values[0];
		const helpCommand = client.commands.get('help')!;
		// @ts-ignore - Hack to pass data around between interactions
		interaction.options = {
			getString: () => commandName
		}
		return helpCommand.execute(interaction as unknown as ChatInputCommandInteraction, client);
	}
} satisfies SelectMenuHandler as SelectMenuHandler;