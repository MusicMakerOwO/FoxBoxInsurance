import { EventHandler } from "../../Typings/HandlerTypes.js";
import { AutocompleteInteraction, ChatInputCommandInteraction as CommandInteraction } from "discord.js";
import { COLOR } from "../../Utils/Constants.js";
import { Log } from "../../Utils/Log.js";
import { RunComponentHandler } from "./Respond.js";
import { client } from "../../Client.js";

export default {
	name: 'command-interaction',
	execute: async (interaction: CommandInteraction | AutocompleteInteraction) => {
		const handler = client.commands.get(interaction.commandName);
		if (!handler) {
			Log('ERROR', 'Command not found');
			if (interaction instanceof CommandInteraction) {
				void interaction.reply({
					embeds: [{
						color: COLOR.ERROR,
						description: "Command not found :("
					}]
				});
			}
			return;
		}

		if (interaction instanceof AutocompleteInteraction) {
			if (!('autocomplete' in handler)) {
				return Log('ERROR', 'Autocomplete interaction but no callback function was found');
			} else {
				return interaction.respond( await handler.autocomplete(interaction, client) );
			}
		}

		await RunComponentHandler(interaction, handler, []);
	}
} as EventHandler;