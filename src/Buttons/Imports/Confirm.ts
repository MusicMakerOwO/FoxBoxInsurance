import {ButtonHandler} from "../../Typings/HandlerTypes";
import {COLOR, EMOJI, SECONDS} from "../../Utils/Constants";
import {SaveImportForGuild} from "../../CRUD/SnapshotImports";
import { TOS_FEATURES } from "../../TOSConstants";
import { DiscordPermissions } from "../../Utils/DiscordConstants";
import { GUILD_FEATURES } from "../../Typings/DatabaseTypes";

export default {
	tos_features  : [ TOS_FEATURES.IMPORT_SNAPSHOTS ],
	guild_features: [ GUILD_FEATURES.IMPORT_SNAPSHOTS ],
	permissions   : [ DiscordPermissions.Administrator ],
	response_type : 'update',
	hidden        : false,
	customID      : 'import-confirm',
	execute       : async function(interaction, client, args) {
		const importID = args[0];

		const importData = client.importCache.get(importID);
		if (!importData) {
			return {
				embeds: [{
					color: COLOR.ERROR,
					title: 'Import Not Found',
					description: 'The import does not exist or has expired.\nPlease import the file and try again.'
				}],
				components: []
			}
		}

		SaveImportForGuild(interaction.guildId!, importData);

		return {
			embeds: [{
				color: 0x00FF00,
				title: 'Snapshot Imported',
				description: `
The snapshot has been added your list, check it out with \`/snapshot list\`
It will be removed from your list <t:${~~(Date.now() / 1000) + SECONDS.MINUTE * 60}:R>`
			}],
			components: [{
				type: 1,
					components: [{
					type: 2,
					style: 2,
					label: 'View Snapshots',
					emoji: { name: EMOJI.OPEN },
					custom_id: 'snapshot-list'
				}]
			}]
		}
	}
} satisfies ButtonHandler as ButtonHandler;