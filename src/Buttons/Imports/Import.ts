import {ButtonHandler} from "../../Typings/HandlerTypes.js";
import {COLOR, EMOJI} from "../../Utils/Constants.js";
import { TOS_FEATURES } from "../../TOSConstants.js";
import { GUILD_FEATURES } from "../../Typings/DatabaseTypes.js";
import { DiscordPermissions } from "../../Utils/DiscordConstants.js";
import {GetStagedImport, IMPORT_EXPIRATION} from "../../CRUD/SnapshotImports.js";
import {ImportNotFound} from "../Snapshots/View/Render.js";

export default {
	tos_features  : [ TOS_FEATURES.IMPORT_SNAPSHOTS ],
	guild_features: [ GUILD_FEATURES.IMPORT_SNAPSHOTS ],
	permissions   : [ DiscordPermissions.Administrator ],
	response_type : 'update',
	hidden        : false,
	customID      : 'import',
	execute       : async function(interaction, client, args) {
		const importID = args[0];

		// Only a staged upload is waiting on this prompt - once listed (or cancelled) the prompt is done
		if (!GetStagedImport(interaction.guildId!, importID)) return ImportNotFound();

		return {
			embeds: [{
				color: COLOR.PRIMARY,
				title: 'Import Snapshot?',
				description: `
__Snapshot can contain harmful data__ like admin roles or broken permissions!
Make sure you trust the person who created it

**Messages are never included in snapshots!**
Once imported, it stays in your list for ${IMPORT_EXPIRATION / 60_000} minutes`
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
						custom_id: `import-cancel_${importID}`,
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