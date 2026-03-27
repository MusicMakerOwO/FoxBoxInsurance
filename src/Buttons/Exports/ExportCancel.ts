import {ButtonHandler} from "../../Typings/HandlerTypes";
import {COLOR, EMOJI} from "../../Utils/Constants";
import { TOS_FEATURES } from "../../TOSConstants";
import { GUILD_FEATURES } from "../../Typings/DatabaseTypes";

export default {
	tos_features  : [ TOS_FEATURES.MESSAGE_EXPORTS ],
	guild_features: [ GUILD_FEATURES.EXPORT_MESSAGES ],
	permissions   : [],
	response_type : 'update',
	hidden        : false,
	customID      : 'export-cancel',
	execute       : async function(interaction, client, args) {
		const confirm = !!args[0];

		if (confirm) {
			void interaction.deleteReply();
			return {};
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