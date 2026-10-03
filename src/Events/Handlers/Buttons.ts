import { EventHandler } from "../../Typings/HandlerTypes.js";
import { ButtonInteraction } from "discord.js";
import { COLOR } from "../../Utils/Constants.js";
import { Log } from "../../Utils/Log.js";
import { RunComponentHandler } from "./Respond.js";
import { client } from "../../Client.js";

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

		await RunComponentHandler(interaction, handler, args);
	}
} as EventHandler;