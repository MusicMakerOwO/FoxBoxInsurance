import {CommandHandler} from "../Typings/HandlerTypes";
import {SlashCommandBuilder} from "discord.js";
import {COLOR} from "../Utils/Constants";

export default {
	tos_features  : [],
	guild_features: [],
	permissions   : [],
	response_type : 'reply',
	hidden        : false,
	data          : new SlashCommandBuilder()
		.setName('donate')
		.setDescription('Show your support by helping us out!'),
	execute       : async function() {
		return {
			embeds: [{
				color: COLOR.PRIMARY,
				description: `
Thank you for using FBI - We are dedicated to providing free and safe moderation for all. \
If you'd like to support us, consider donating to our ☕ Ko-fi page. \
__All donations go directly to server costs.__

**Current server costs** : $13.69/month`
			}],
			components: [{
				type: 1,
				components: [{
					type: 2,
					style: 5,
					label: 'Donate ❤️',
					url: 'https://ko-fi.com/musicmaker'
				}]
			}]
		}
	}
} satisfies CommandHandler as CommandHandler;