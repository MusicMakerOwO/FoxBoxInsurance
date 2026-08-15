import {ButtonHandler} from "../../Typings/HandlerTypes.js";
import {GetExportCache} from "../../Utils/Caching/GetExportCache.js";
import { TOS_FEATURES } from "../../TOSConstants.js";
import { GUILD_FEATURES } from "../../Typings/DatabaseTypes.js";

export default {
	tos_features  : [ TOS_FEATURES.MESSAGE_EXPORTS ],
	guild_features: [ GUILD_FEATURES.EXPORT_MESSAGES ],
	permissions   : [],
	response_type : 'modal',
	hidden        : false,
	customID      : 'export-channel',
	execute       : async function(interaction) {
		// @ts-expect-error | GetExportCache calls interaction.editReply, which NoReply<...> strips from the handler interaction type
		const exportOptions = await GetExportCache(interaction);
		if (!exportOptions) return {};

		return {
			title: 'Export Channel',
			custom_id: 'export-channel',
			components: [{
				type: 18,
				label: 'Select the channel to export from',
				component: {
					type: 8,
					custom_id: 'data',
					required: true
				}
			}]
		}
	}
} satisfies ButtonHandler as ButtonHandler;