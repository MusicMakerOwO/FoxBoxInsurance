import {ButtonHandler} from "../Typings/HandlerTypes";
import {COLOR} from "../Utils/Constants";
import {APIEmbed} from "discord-api-types/v10";
import {MAX_TOS_VERSION} from "../TOSConstants";
import {SetUserTOSVersion} from "../Services/UserTOS";

export default {
	tos_features  : [],
	guild_features: [],
	permissions   : [],
	response_type : 'reply',
	hidden        : true,
	customID      : 'tos-accept',
	execute       : async function(interaction, client, args) {
		const guildID = args[0] ?? interaction.guild?.id;
		if (!guildID) throw new Error('Guild ID not found');

		const guild = client.guilds.cache.get(guildID);
		if (!guild) throw new Error('Guild not found');

		const targetTOSVersion = parseInt(args[0]) || MAX_TOS_VERSION;

		const embed: APIEmbed = {
			color: COLOR.PRIMARY,
			description: `
**Thank you for accepting the terms**
You can now start using the bot`
		}

		await SetUserTOSVersion(interaction.user.id, targetTOSVersion);

		return { embeds: [embed], components: [] }
	}
} satisfies ButtonHandler as ButtonHandler;