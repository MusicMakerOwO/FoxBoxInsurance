import {ButtonHandler} from "../../Typings/HandlerTypes";
import { TOS_FEATURES } from "../../TOSConstants";
import { GUILD_FEATURES } from "../../Typings/DatabaseTypes";

export default {
	tos_features  : [ TOS_FEATURES.SERVER_SNAPSHOTS ],
	guild_features: [ GUILD_FEATURES.MANAGE_SNAPSHOTS ],
	permissions   : [],
	response_type : 'update',
	hidden        : false,
	customID      : 'snapshot-view',
	execute       : async function(interaction, client, args) {
		const snapshotID = parseInt(args[0]);
		if (isNaN(snapshotID) || snapshotID <= 0) throw new Error('Invalid snapshot ID provided.');

		return {
			components: [{
				type      : 1,
				components: [
					{
						type     : 2,
						style    : 2,
						custom_id: `snapshot-manage_${snapshotID}`,
						emoji    : { name: '◀️' }
					},
					{
						type     : 2,
						style    : 2,
						custom_id: `snapshot-view-channels_${snapshotID}`,
						label    : 'Channels',
						emoji    : { name: '💬' }
					},
					{
						type     : 2,
						style    : 2,
						custom_id: `snapshot-view-roles_${snapshotID}`,
						label    : 'Roles',
						emoji    : { name: '👥' }
					},
					{
						type     : 2,
						style    : 2,
						custom_id: `snapshot-view-bans_${snapshotID}`,
						label    : 'Bans',
						emoji    : { name: '🚫' }
					}
				]
			}]
		}
	}
} satisfies ButtonHandler as ButtonHandler;