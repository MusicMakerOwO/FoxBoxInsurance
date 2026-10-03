import {ButtonHandler} from "../Typings/HandlerTypes.js";
import {COLOR} from "../Utils/Constants.js";
import {APIEmbed} from "discord-api-types/v10";
import {MAX_TOS_VERSION} from "../TOSConstants.js";
import {SetUserTOSVersion} from "../Services/UserTOS.js";
import {GetUser} from "../CRUD/Users.js";

export default {
	tos_features  : [],
	guild_features: [],
	permissions   : [],
	response_type : 'update',
	hidden        : true,
	customID      : 'tos-accept',
	execute       : async function(interaction, client, args) {
		// No arg means the latest terms. Anything else has to name a published version - an unknown
		// one above MAX would count as accepting every future version too (see CanUserAccessTOSFeature)
		const targetTOSVersion = args[0] === undefined ? MAX_TOS_VERSION : (/^\d+$/.test(args[0]) ? Number(args[0]) : NaN);
		if (!(targetTOSVersion >= 1 && targetTOSVersion <= MAX_TOS_VERSION)) {
			throw new Error(`Invalid TOS version '${args[0]}'`);
		}

		const embed: APIEmbed = {
			color: COLOR.PRIMARY,
			description: `
**Thank you for accepting the terms**
You can now start using the bot`
		}

		// An old prompt clicked later must not take newer terms (and their features) away again
		const savedUser = await GetUser(interaction.user.id);
		if (!savedUser || savedUser.terms_version_accepted < targetTOSVersion) {
			await SetUserTOSVersion(interaction.user.id, targetTOSVersion);
		}

		return { embeds: [embed], components: [] }
	}
} satisfies ButtonHandler as ButtonHandler;
