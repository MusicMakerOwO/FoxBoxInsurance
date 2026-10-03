import {ButtonHandler} from "../../Typings/HandlerTypes.js";
import {DiscardStagedImport} from "../../CRUD/SnapshotImports.js";
import { TOS_FEATURES } from "../../TOSConstants.js";
import { GUILD_FEATURES } from "../../Typings/DatabaseTypes.js";
import { DiscordPermissions } from "../../Utils/DiscordConstants.js";

export default {
	tos_features  : [ TOS_FEATURES.IMPORT_SNAPSHOTS ],
	guild_features: [ GUILD_FEATURES.IMPORT_SNAPSHOTS ],
	permissions   : [ DiscordPermissions.Administrator ],
	response_type : 'update',
	hidden        : false,
	customID      : 'import-cancel',
	execute       : async function(interaction, client, args) {
		// Only the staged upload - an already-listed copy of the same file stays listed
		DiscardStagedImport(interaction.guildId!, args[0]);
		return { delete: true };
	}
} satisfies ButtonHandler as ButtonHandler;
