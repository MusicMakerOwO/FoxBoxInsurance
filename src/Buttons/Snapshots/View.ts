import {ButtonHandler} from "../../Typings/HandlerTypes.js";
import { TOS_FEATURES } from "../../TOSConstants.js";
import { GUILD_FEATURES } from "../../Typings/DatabaseTypes.js";
import { DiscordPermissions } from "../../Utils/DiscordConstants.js";
import {GetGuildSnapshot, ParseStoredSnapshotID} from "../../Services/SnapshotLookup.js";
import {SnapshotNotFound} from "./View/Render.js";

export default {
	tos_features  : [ TOS_FEATURES.SERVER_SNAPSHOTS ],
	guild_features: [ GUILD_FEATURES.MANAGE_SNAPSHOTS ],
	permissions   : [ DiscordPermissions.Administrator ],
	response_type : 'update',
	hidden        : false,
	customID      : 'snapshot-view',
	execute       : async function(interaction, client, args) {
		const snapshotID = ParseStoredSnapshotID(args[0]);
		if (snapshotID === null) throw new Error('Invalid snapshot ID provided.');

		if (!await GetGuildSnapshot(interaction.guildId!, String(snapshotID))) return SnapshotNotFound();

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