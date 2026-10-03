import {ButtonHandler} from "../../Typings/HandlerTypes.js";
import { TOS_FEATURES } from "../../TOSConstants.js";
import { GUILD_FEATURES } from "../../Typings/DatabaseTypes.js";
import { DiscordPermissions } from "../../Utils/DiscordConstants.js";
import {FindImport} from "../../Services/SnapshotLookup.js";
import {ImportNotFound} from "../Snapshots/View/Render.js";

export default {
	tos_features  : [ TOS_FEATURES.IMPORT_SNAPSHOTS ],
	guild_features: [ GUILD_FEATURES.IMPORT_SNAPSHOTS ],
	permissions   : [ DiscordPermissions.Administrator ],
	response_type : 'update',
	hidden        : false,
	customID      : 'import-view',
	execute       : async function(interaction, client, args) {
		const importID = args[0];

		const found = FindImport(interaction.guildId!, importID);
		if (!found) return ImportNotFound();

		return {
			components: [{
				type: 1,
				components: [
					{
						type: 2,
						style: 2,
						// Still behind the warning prompt -> back to it, otherwise it was opened from snapshot-manage
						custom_id: found.staged ? `import_${importID}` : `snapshot-manage_${importID}`,
						emoji: { name: '◀️' }
					},
					{
						type: 2,
						style: 2,
						custom_id: `import-view-channels_${importID}`,
						label: 'Channels',
						emoji: { name: '💬' }
					},
					{
						type: 2,
						style: 2,
						custom_id: `import-view-roles_${importID}`,
						label: 'Roles',
						emoji: { name: '👥' }
					},
					{
						type: 2,
						style: 2,
						custom_id: `import-view-bans_${importID}`,
						label: 'Bans',
						emoji: { name: '🚫' }
					}
				]
			}]
		}
	}
} satisfies ButtonHandler as ButtonHandler;