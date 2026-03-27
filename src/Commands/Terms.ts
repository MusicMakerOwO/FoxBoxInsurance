import {CommandHandler} from "../Typings/HandlerTypes";
import {COLOR} from "../Utils/Constants";
import {SlashCommandBuilder} from "discord.js";

export default {
	tos_features  : [],
	guild_features: [],
	permissions   : [],
	response_type : 'reply',
	hidden        : false,
	aliases       : ['privacy'],
	data          : new SlashCommandBuilder()
	.setName('terms')
	.setDescription('View the TOS and privacy policy'),
	execute       : async function() {
		return {
			embeds: [{
				color: COLOR.PRIMARY,
				description: `
You can find a copy of the Terms of Service and Privacy Policy at the respective links below.

**Privacy Policy** : https://notfbi.dev/privacy
**Terms of Service** : https://notfbi.dev/terms

For any privacy concerns or legal troubles please reach out to me on one of the following:
\\- Discord: \`@musicmaker\`
\\- Email: \`legal@notfbi.dev\`
\\- Support Server: https://notfbi.dev/support`
			}]
		};
	}
} satisfies CommandHandler as CommandHandler;