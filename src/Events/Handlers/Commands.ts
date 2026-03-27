import { EventHandler } from "../../Typings/HandlerTypes";
import { AutocompleteInteraction, ChatInputCommandInteraction as CommandInteraction } from "discord.js";
import { COLOR } from "../../Utils/Constants";
import { Log } from "../../Utils/Log";
import { CheckHandlerAccess } from "../../Utils/CheckHandlerAccess";
import { client } from "../../Client";

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

		const errorResponse = await CheckHandlerAccess(interaction, handler);
		if (errorResponse) return interaction.editReply(errorResponse);

		const response = await handler.execute(interaction, client);
		if (!response) throw new Error('No response received from handler - possible error?');

		if (handler.response_type === 'modal') {
			if (!('title' in response)) throw new Error('Component cannot defer and send a modal at the same time');
			void interaction.showModal(response);
		} else {
			void interaction.editReply(response);
		}
	}
} as EventHandler;