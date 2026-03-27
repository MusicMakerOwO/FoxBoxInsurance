import { CommandHandler } from "../Typings/HandlerTypes";
import { COLOR } from "../Utils/Constants";
import { SlashCommandBuilder } from "discord.js";

export default {
	tos_features  : [],
	guild_features: [],
	permissions   : [],
	response_type : 'reply',
	hidden        : false,
	data          : new SlashCommandBuilder()
	.setName('vote')
	.setDescription('Help FBI by voting for us'),
	execute       : async function () {
		return {
			embeds    : [{
				color      : COLOR.PRIMARY,
				description: `
Thank you for using FBI - We are dedicated to providing free and safe moderation for all.
If you'd like to support us, consider voting for us on top.gg ❤️

https://top.gg/bot/1065103018212732938`
			}],
			components: [{
				type      : 1,
				components: [{
					type : 2,
					style: 5,
					label: 'Open Top.gg',
					url  : 'https://top.gg/bot/1065103018212732938/vote'
				}]
			}]
		}
	}
} satisfies CommandHandler as CommandHandler;