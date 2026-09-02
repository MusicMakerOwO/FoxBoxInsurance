import { ButtonHandler } from "../../Typings/HandlerTypes.js";
import { TOS_FEATURES } from "../../TOSConstants.js";
import { GUILD_FEATURES } from "../../Typings/DatabaseTypes.js";
import { DiscordPermissions } from "../../Utils/DiscordConstants.js";
import { RenderSnapshotManage } from "../Snapshots/Manage.js";

export default {
	tos_features  : [ TOS_FEATURES.SERVER_SNAPSHOTS ],
	// `snapshot-manage` is gated on MANAGE_SNAPSHOTS, but this button is part of the restore report -
	// a guild with restore enabled must be able to reach the snapshot that rolls it back
	guild_features: [ GUILD_FEATURES.RESTORE_SNAPSHOTS ],
	permissions   : [ DiscordPermissions.Administrator ],
	// Deliberately not 'update' like `snapshot-manage` is: this button lives on the public step log,
	// and updating would replace the run's own report - its failure causes, counts, log and retry -
	// with the manage screen, permanently and for everyone
	response_type : 'reply',
	hidden        : true,
	customID      : 'restore-safety',
	execute       : async function(interaction, client, args) {
		return await RenderSnapshotManage(interaction.guildId!, args[0]);
	}
} satisfies ButtonHandler as ButtonHandler;
