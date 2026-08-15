import { EventHandler } from "../../Typings/HandlerTypes.js";
import { ModalSubmitInteraction } from "discord.js";
import { COLOR } from "../../Utils/Constants.js";
import { Log } from "../../Utils/Log.js";
import { CheckHandlerAccess } from "../../Utils/CheckHandlerAccess.js";
import { client } from "../../Client.js";

export default {
	name: 'modal-interaction',
	execute: async (interaction: ModalSubmitInteraction) => {

		const args = interaction.customId.split('_');
		const customId = args.shift()!;

		const handler = client.modals.get(customId);
		if (!handler) {
			Log('ERROR', 'Modal not found');
			return interaction.reply({
				embeds: [{
					color: COLOR.ERROR,
					description: "Modal not found :("
				}]
			});
		}

		const errorResponse = await CheckHandlerAccess(interaction, handler);
		if (errorResponse) return interaction.editReply(errorResponse);

		const response = await handler.execute(interaction, client, args);
		if (!response) return Log('WARN', 'No response received from handler - possible error?');

		void interaction.editReply(response);
	}
} as EventHandler;