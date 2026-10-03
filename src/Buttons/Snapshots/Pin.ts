import {COLOR, EMOJI} from "../../Utils/Constants.js";
import {ButtonHandler, InteractionResponse} from "../../Typings/HandlerTypes.js";
import { ParseStoredSnapshotID } from "../../Services/SnapshotLookup.js";
import { ListSnapshotsForGuild, MaxSnapshotsForGuild, SetSnapshotPinStatus } from "../../CRUD/Snapshots.js";
import { TOS_FEATURES } from "../../TOSConstants.js";
import { GUILD_FEATURES } from "../../Typings/DatabaseTypes.js";
import { DiscordPermissions } from "../../Utils/DiscordConstants.js";

const SNAPSHOTS_FULL = {
	embeds: [{
		color: COLOR.ERROR,
		title: 'Snapshots Full',
		description: `
You have reached the maximum number of pinned snapshots for this server.
Please unpin a snapshot before pinning another.`
	}],
	components: []
} satisfies InteractionResponse;

export default {
	tos_features  : [ TOS_FEATURES.SERVER_SNAPSHOTS ],
	guild_features: [ GUILD_FEATURES.MANAGE_SNAPSHOTS ],
	permissions   : [ DiscordPermissions.Administrator ],
	response_type : 'update',
	hidden        : true,
	customID      : 'snapshot-pin',
	execute       : async function(interaction, client, args) {
		const snapshotID = ParseStoredSnapshotID(args[0]);
		if (snapshotID === null) {
			throw new Error(`Invalid snapshot ID provided: ${args[0]}`);
		}
		const confirm = args[1] === 'confirm';
		const unpin = !!args[2];

		// Read on both paths - the confirm button can be clicked long after the prompt was rendered
		const snapshots = await ListSnapshotsForGuild(interaction.guildId!);
		const targetSnapshot = snapshots.find(x => x.id === snapshotID);
		if (!targetSnapshot) return {
			embeds: [{
				color: COLOR.ERROR,
				description: 'Snapshot does not exist - Was it deleted?',
			}],
			components: []
		}

		// Only pinning is capped - unpinning must always be possible, or a full server could never free a slot
		const pinnedCount = snapshots.reduce((acc, snapshot) => acc + +snapshot.pinned, 0);
		const maxSnapshots = await MaxSnapshotsForGuild(interaction.guildId!);
		const pinning = confirm ? !unpin : !targetSnapshot.pinned;
		if (pinning && !targetSnapshot.pinned && pinnedCount >= maxSnapshots) return SNAPSHOTS_FULL;

		if (!confirm) {
			return {
				embeds: [ targetSnapshot.pinned ? {
					color: COLOR.PRIMARY,
					title: 'Unpin Snapshot',
					description: `
Unpinning a snapshot will __allow it to be deleted__.
Once a snapshot is deleted it cannot be recovered!
**Do you want to unpin this snapshot?**`
				} : {
					color: COLOR.PRIMARY,
					title: 'Pin Snapshot',
					description: `
Pinning a snapshot will keep a permanent record of it in the server.
They __cannot be deleted or modified__, great for looking back at important moments!

Pinned snapshots still count towards your snapshot limit!

**Do you want to pin this snapshot?**`
				}],
				components: [{
					type: 1,
					components: [
						targetSnapshot.pinned ? {
							type: 2,
							style: 4,
							label: 'Unpin Snapshot',
							custom_id: `snapshot-pin_${snapshotID}_confirm_1`,
							emoji: { name: EMOJI.DELETE },
						} : {
							type: 2,
							style: 3,
							label: 'Pin Snapshot',
							custom_id: `snapshot-pin_${snapshotID}_confirm`,
							emoji: { name: EMOJI.PIN },
						},
						{
							type: 2,
							style: 4,
							label: 'Cancel',
							custom_id: `snapshot-manage_${snapshotID}`
						}
					]
				}]
			}
		}

		await SetSnapshotPinStatus(snapshotID, !unpin);

		return {
			embeds: [ unpin ? {
				color: COLOR.PRIMARY,
				description: `${EMOJI.DELETE} The snapshot has been unpinned successfully!`
			} : {
				color: COLOR.PRIMARY,
				description: `${EMOJI.TADA} The snapshot has been pinned successfully!`
			}],
			components: [{
				type: 1,
				components: [{
					type: 2,
					style: 2,
					custom_id: `snapshot-manage_${snapshotID}`,
					label: 'Back'
				}]
			}]
		}
	}
} satisfies ButtonHandler as ButtonHandler;