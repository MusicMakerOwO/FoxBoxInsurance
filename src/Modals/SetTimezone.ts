import { InteractionResponse, ModalHandler } from "../Typings/HandlerTypes.js";
import { ConvertTimezone, SetTimezone } from "../CRUD/UserTimezones.js";
import { ButtonInteraction } from "discord.js";

export default {
	tos_features: [],
	guild_features: [],
	permissions: [],
	response_type: 'update',
	hidden: false,
	customID: 'set-timezone',
	execute: async function(interaction, client, args) {
		const input = interaction.fields.getTextInputValue('data').trim().toUpperCase();
		const timezone = ConvertTimezone(input);
		await SetTimezone(interaction.user.id, timezone);
		const button = client.buttons.get('activity')!;
		return await button.execute(interaction as unknown as ButtonInteraction, client, args) as InteractionResponse;
	}
} satisfies ModalHandler as ModalHandler;