import {ButtonHandler} from "../../../Typings/HandlerTypes.js";
import {GetGuildSnapshot, ParseStoredSnapshotID} from "../../../Services/SnapshotLookup.js";
import { TOS_FEATURES } from "../../../TOSConstants.js";
import { GUILD_FEATURES } from "../../../Typings/DatabaseTypes.js";
import { DiscordPermissions } from "../../../Utils/DiscordConstants.js";
import {RenderViewer, SnapshotNotFound, ViewerLines} from "./Render.js";

export default {
	tos_features  : [ TOS_FEATURES.SERVER_SNAPSHOTS ],
	guild_features: [ GUILD_FEATURES.MANAGE_SNAPSHOTS ],
	permissions   : [ DiscordPermissions.Administrator ],
	response_type : 'update',
	hidden        : false,
	customID      : 'snapshot-view-bans',
	execute       : async function(interaction, client, args) {
		const snapshotID = ParseStoredSnapshotID(args[0]);
		if (snapshotID === null) throw new Error('Invalid snapshot ID provided.');

		const snapshotData = await GetGuildSnapshot(interaction.guildId!, String(snapshotID));
		if (!snapshotData) return SnapshotNotFound();

		return RenderViewer({
			prefix: `snapshot-view-bans_${snapshotID}`,
			label : `Snapshot #${snapshotID}`,
			source: 'snapshot',
			kind  : 'bans',
			lines : ViewerLines(snapshotData, 'bans'),
			back  : `snapshot-manage_${snapshotID}`
		}, args[1]);
	}
} satisfies ButtonHandler as ButtonHandler;
