import { ButtonHandler } from "../../Typings/HandlerTypes.js";
import { COLOR } from "../../Utils/Constants.js";
import { GetGuildSnapshot } from "../../Services/SnapshotLookup.js";
import { TOS_FEATURES } from "../../TOSConstants.js";
import { GUILD_FEATURES } from "../../Typings/DatabaseTypes.js";
import { DiscordPermissions } from "../../Utils/DiscordConstants.js";
import { BuildRestorePlan, RestorePlanError } from "../../Services/RestorePlans.js";
import { UploadCDN } from "../../Utils/UploadCDN.js";
import { JSONReplacer } from "../../JSON.js";

export default {
	tos_features  : [ TOS_FEATURES.SERVER_SNAPSHOTS ],
	guild_features: [ GUILD_FEATURES.RESTORE_SNAPSHOTS ],
	permissions   : [ DiscordPermissions.Administrator ],
	response_type : 'update',
	hidden        : true,
	customID      : 'restore-plan',
	execute       : async function(interaction, client, args) {
		const [id, maskArg] = args;
		const mask = parseInt(maskArg) || 0;

		const snapshotData = await GetGuildSnapshot(interaction.guildId!, id);
		if (!snapshotData) {
			return {
				embeds: [{
					color: COLOR.ERROR,
					title: 'Snapshot Not Found',
					description: `Snapshot not found or already deleted\nCreate one using \`/snapshot create\``
				}],
				components: []
			}
		}

		let plan;
		try {
			plan = await BuildRestorePlan(interaction.guild!, snapshotData, mask);
		} catch (error) {
			if (error instanceof RestorePlanError) {
				return {
					embeds: [{
						color: COLOR.ERROR,
						title: 'Could Not Build Restore Plan',
						description: error.message
					}]
				}
			}
			throw error;
		}

		const serialized = JSON.stringify(plan, JSONReplacer, '\t');
		const lookup = await UploadCDN(`restore-plan-${id}.json`, Buffer.from(serialized, 'utf8'), 1); // 1 url = 1 download

		return {
			embeds: [{
				color: COLOR.PRIMARY,
				description: `
**Download Link:** [Click here to download](https://cdn.notfbi.dev/download/${lookup})
**File Size:** ${(serialized.length / 1024).toFixed(2)} KB
**Actions:** ${plan.actions.length}`
			}],
			components: [{
				type: 1,
				components: [{
					type: 2,
					style: 5,
					label: 'Download',
					url: `https://cdn.notfbi.dev/download/${lookup}`,
					emoji: { name: '📥' }
				}]
			}]
		}
	}
} satisfies ButtonHandler as ButtonHandler;
