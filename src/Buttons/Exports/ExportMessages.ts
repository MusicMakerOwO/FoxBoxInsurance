import {ButtonHandler} from "../../Typings/HandlerTypes";
import {GetExportCache} from "../../Utils/Caching/GetExportCache";
import { TOS_FEATURES } from "../../TOSConstants";
import { GUILD_FEATURES } from "../../Typings/DatabaseTypes";

export default {
	tos_features  : [ TOS_FEATURES.MESSAGE_EXPORTS ],
	guild_features: [ GUILD_FEATURES.EXPORT_MESSAGES ],
	permissions   : [],
	response_type : 'modal',
	hidden        : false,
	customID      : 'export-messages',
	execute       : async function(interaction) {
		// @ts-expect-error
		const exportOptions = await GetExportCache(interaction);
		if (!exportOptions) return {};

		return {
			title: 'Export Messages',
			custom_id: 'export-messages',
			components: [{
				type: 1,
				components: [{
					type: 4,
					custom_id: 'data',
					label: 'How many messages to export?',
					placeholder: 'Enter a number between 1 and 10,000',
					style: 1,
					min_length: 1,
					max_length: 6,
					required: true
				}]
			}]
		}
	}
} satisfies ButtonHandler as ButtonHandler;