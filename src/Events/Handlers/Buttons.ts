import { EventHandler } from "../../Typings/HandlerTypes";
import { ButtonInteraction } from "discord.js";
import { COLOR } from "../../Utils/Constants";
import { Log } from "../../Utils/Log";
import { CheckHandlerAccess } from "../../Utils/CheckHandlerAccess";
import { client } from "../../Client";

export default {
	name: 'button-interaction',
	execute: async (interaction: ButtonInteraction) => {

		const args = interaction.customId.split('_');
		const customId = args.shift()!;

		const handler = client.buttons.get(customId);
		if (!handler) {
			Log('ERROR', 'Button not found');
			return interaction.reply({
				embeds: [{
					color: COLOR.ERROR,
					description: "Button not found :("
				}]
			});
		}

		const errorResponse = await CheckHandlerAccess(interaction, handler);
		if (errorResponse) return interaction.editReply(errorResponse);

		const response = await handler.execute(interaction, client, args);
		if (!response) return Log('WARN', 'No response received from handler - possible error?');

		if (handler.response_type === 'modal') {
			if (!('title' in response)) throw new Error('Component cannot defer and send a modal at the same time');
			void interaction.showModal(response);
		} else {
			void interaction.editReply(response);
		}
	}
} as EventHandler;