import { CommandHandler, InteractionResponse } from "../Typings/HandlerTypes.js";
import { ButtonInteraction, SlashCommandBuilder } from "discord.js";
import { TOS_FEATURES } from "../TOSConstants.js";
import { GUILD_FEATURES } from "../Typings/DatabaseTypes.js";

export default {
	tos_features: [TOS_FEATURES.MESSAGE_EXPORTS],
	guild_features: [GUILD_FEATURES.MESSAGE_HISTORY],
	permissions: [],
	response_type: 'reply',
	hidden: true,
	aliases: ['chart', 'graph'],
	data: new SlashCommandBuilder()
		.setName('activity')
		.setDescription('View historical server activity over time')
		.addChannelOption(x => x
			.setName('channel')
			.setDescription('Specific channel to view')
			.setRequired(false)
		),
	execute: async function (interaction, client) {
		const button = client.buttons.get('activity')!;
		return await button.execute(interaction as unknown as ButtonInteraction, client, ['day']) as InteractionResponse;
	}
} satisfies CommandHandler as CommandHandler;