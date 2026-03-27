import {ButtonHandler} from "../../Typings/HandlerTypes";
import { TOS_FEATURES } from "../../TOSConstants";
import { GUILD_FEATURES } from "../../Typings/DatabaseTypes";

export default {
	tos_features  : [ TOS_FEATURES.IMPORT_SNAPSHOTS ],
	guild_features: [ GUILD_FEATURES.IMPORT_SNAPSHOTS ],
	permissions   : [],
	response_type : 'update',
	hidden        : false,
	customID      : 'import-view',
	execute       : async function(interaction, client, args) {
		const importID = args[0];
		const managed = args[1] || '';

		return {
			components: [{
				type: 1,
				components: [
					{
						type: 2,
						style: 2,
						custom_id: managed ? `snapshot-manage_${importID}_${managed}` : `import_${importID}`,
						emoji: { name: '◀️' }
					},
					{
						type: 2,
						style: 2,
						custom_id: `import-view-channels_${importID}_${managed}`,
						label: 'Channels',
						emoji: { name: '💬' }
					},
					{
						type: 2,
						style: 2,
						custom_id: `import-view-roles_${importID}_${managed}`,
						label: 'Roles',
						emoji: { name: '👥' }
					},
					{
						type: 2,
						style: 2,
						custom_id: `import-view-bans_${importID}_${managed}`,
						label: 'Bans',
						emoji: { name: '🚫' }
					}
				]
			}]
		}
	}
} satisfies ButtonHandler as ButtonHandler;