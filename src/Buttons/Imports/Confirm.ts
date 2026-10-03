import {ButtonHandler} from "../../Typings/HandlerTypes.js";
import {COLOR, EMOJI} from "../../Utils/Constants.js";
import {SaveImportForGuild} from "../../CRUD/SnapshotImports.js";
import {FindImport} from "../../Services/SnapshotLookup.js";
import {ImportNotFound} from "../Snapshots/View/Render.js";
import { TOS_FEATURES } from "../../TOSConstants.js";
import { DiscordPermissions } from "../../Utils/DiscordConstants.js";
import { GUILD_FEATURES } from "../../Typings/DatabaseTypes.js";

export default {
	tos_features  : [ TOS_FEATURES.IMPORT_SNAPSHOTS ],
	guild_features: [ GUILD_FEATURES.IMPORT_SNAPSHOTS ],
	permissions   : [ DiscordPermissions.Administrator ],
	response_type : 'update',
	hidden        : false,
	customID      : 'import-confirm',
	execute       : async function(interaction, client, args) {
		const importID = args[0];

		// Staged is the normal case; already listed means the same file was uploaded and confirmed twice
		const found = FindImport(interaction.guildId!, importID);
		if (!found) return ImportNotFound();

		const expiresAt = SaveImportForGuild(interaction.guildId!, found.data);

		return {
			embeds: [{
				color: COLOR.SUCCESS,
				title: 'Snapshot Imported',
				description: `
The snapshot has been added to your list, check it out with \`/snapshot list\`
It will be removed from your list <t:${Math.floor(expiresAt / 1000)}:R>`
			}],
			components: [{
				type: 1,
					components: [{
					type: 2,
					style: 2,
					label: 'View Snapshots',
					emoji: {
						name: 'launch',
						id: EMOJI.OPEN
					},
					custom_id: 'snapshot-list'
				}]
			}]
		}
	}
} satisfies ButtonHandler as ButtonHandler;