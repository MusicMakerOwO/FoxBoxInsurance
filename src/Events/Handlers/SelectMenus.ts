import { EventHandler } from "../../Typings/HandlerTypes.js";
import { SelectMenuInteraction } from "discord.js";
import { COLOR } from "../../Utils/Constants.js";
import { Log } from "../../Utils/Log.js";
import { RunComponentHandler } from "./Respond.js";
import { client } from "../../Client.js";

export default {
	name: 'menu-interaction',
	execute: async (interaction: SelectMenuInteraction) => {

		const args = interaction.customId.split('_');
		const customId = args.shift()!;

		const handler = client.menus.get(customId);
		if (!handler) {
			Log('ERROR', 'Select menu not found');
			return interaction.reply({
				embeds: [{
					color: COLOR.ERROR,
					description: "Dropdown not found :("
				}]
			});
		}

		await RunComponentHandler(interaction, handler, args);
	}
} as EventHandler;