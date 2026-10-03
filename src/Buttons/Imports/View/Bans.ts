import {ButtonHandler} from "../../../Typings/HandlerTypes.js";
import {FindImport} from "../../../Services/SnapshotLookup.js";
import { TOS_FEATURES } from "../../../TOSConstants.js";
import { DiscordPermissions } from "../../../Utils/DiscordConstants.js";
import {ImportNotFound, RenderViewer, ViewerLines} from "../../Snapshots/View/Render.js";

export default {
	tos_features  : [ TOS_FEATURES.IMPORT_SNAPSHOTS ],
	guild_features: [],
	permissions   : [ DiscordPermissions.Administrator ],
	response_type : 'update',
	hidden        : false,
	customID      : 'import-view-bans',
	execute       : async function(interaction, client, args) {
		const importID = args[0];

		const found = FindImport(interaction.guildId!, importID);
		if (!found) return ImportNotFound();

		return RenderViewer({
			prefix: `import-view-bans_${importID}`,
			label : `Import #${importID}`,
			source: 'import',
			kind  : 'bans',
			lines : ViewerLines(found.data, 'bans'),
			// Still behind the warning prompt -> back to it, otherwise it was opened from snapshot-manage
			back  : found.staged ? `import_${importID}` : `snapshot-manage_${importID}`
		}, args[1]);
	}
} satisfies ButtonHandler as ButtonHandler;
