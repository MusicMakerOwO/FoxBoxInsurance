import {ButtonHandler} from "../../Typings/HandlerTypes";
import {COLOR, EMOJI} from "../../Utils/Constants";
import { TOS_FEATURES } from "../../TOSConstants";
import { GUILD_FEATURES } from "../../Typings/DatabaseTypes";

export default {
	tos_features  : [ TOS_FEATURES.IMPORT_SNAPSHOTS ],
	guild_features: [ GUILD_FEATURES.IMPORT_SNAPSHOTS ],
	permissions   : [],
	response_type : 'update',
	hidden        : false,
	customID      : 'import',
	execute       : async function(interaction, client, args) {
		const importID = args[0];

		return {
			embeds: [{
				color: COLOR.PRIMARY,
				title: 'Import Snapshot?',
				description: `
__Snapshot can contain harmful data__ like admin roles or broken permissions!
Make sure you trust the person who created it

**Messages are never included in snapshots!**
This snapshot will be removed from your list after 60 minutes`
			}],
			components: [{
				type: 1,
				components: [
					{
						type: 2,
						style: 2,
						label: 'View',
						custom_id: `import-view_${importID}`,
						emoji: { name: EMOJI.SEARCH }
					},
					{
						type: 2,
						style: 4,
						label: 'Cancel',
						custom_id: 'close',
						emoji: { name: EMOJI.DELETE }
					},
					{
						type: 2,
						style: 3,
						label: 'Import',
						custom_id: `import-confirm_${importID}`,
						emoji: { name: EMOJI.IMPORT }
					}
				]
			}]
		}
	}
} satisfies ButtonHandler as ButtonHandler;