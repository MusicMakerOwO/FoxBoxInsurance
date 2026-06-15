import { SlashCommandBuilder } from "discord.js";
import { CommandHandler } from "../Typings/HandlerTypes";
import { COLOR } from "../Utils/Constants";

export default {
	response_type: 'reply',
	hidden: true,
	tos_features: [],
	guild_features: [],
	permissions: [],
	data: new SlashCommandBuilder()
	.setName("data-collection")
	.setDescription("Set your preferences on data collection"),
	execute: async (interaction) => {
		return {
			embeds: [{
				color: COLOR.PRIMARY,
				title: "Data Collection Preferences",
				description: `
As enforced by Discord, users must have the option to opt out of "data collection". Data collection on FBI only pertains to message content, attachments, emojis, etc. Although not recommended, you have the power to redact all of your future messages saved on FBI.

The following message metadata will **always** remain for functional purposes:
- Guild ID
- Channel ID
- Message ID
- User ID

> **Note** : This only affects exports on FBI. Users can always screenshot your messages. Please don't do anything dumb.`
			}],
			components: [
				{
					type: 1,
					components: [
						{
							type     : 2,
							style    : 4,
							label    : 'Opt Out',
							custom_id: 'data-collection_out'
						},
						{
							type     : 2,
							style    : 3,
							label    : 'Opt In',
							custom_id: 'data-collection_in'
						}
					]
				}
			]
		}
	}
} satisfies CommandHandler as CommandHandler;