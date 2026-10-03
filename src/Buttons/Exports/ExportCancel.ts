import {ButtonHandler} from "../../Typings/HandlerTypes.js";
import {COLOR, EMOJI} from "../../Utils/Constants.js";
import { TOS_FEATURES } from "../../TOSConstants.js";
import { GUILD_FEATURES } from "../../Typings/DatabaseTypes.js";
import { CreateExportCacheKey } from "../../Typings/CacheEntries.js";

export default {
	tos_features  : [ TOS_FEATURES.MESSAGE_EXPORTS ],
	guild_features: [ GUILD_FEATURES.EXPORT_MESSAGES ],
	permissions   : [],
	response_type : 'update',
	hidden        : false,
	customID      : 'export-cancel',
	execute       : async function(interaction, client, args) {
		if (args[0] === 'confirm') {
			// Otherwise an export-main / export-finish left in another message could still export it
			client.exportCache.delete(CreateExportCacheKey(interaction.channelId, interaction.user.id));
			return { delete: true };
		}

		return {
			embeds: [{
				color: COLOR.ERROR,
				description: 'Are you sure you want to cancel the export?'
			}],
			components: [{
				type: 1,
				components: [
					{
						type: 2,
						style: 4,
						label: 'Delete',
						custom_id: 'export-cancel_confirm',
						emoji: { name: EMOJI.DELETE }
					},
					{
						type: 2,
						style: 3,
						label: 'Take me back!',
						custom_id: 'export-main'
					}
				]
			}]
		}
	}
} satisfies ButtonHandler as ButtonHandler;