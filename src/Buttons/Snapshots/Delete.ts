import {DeleteSnapshot} from "../../CRUD/Snapshots.js";
import {ButtonHandler, InteractionResponse} from "../../Typings/HandlerTypes.js";
import {COLOR, EMOJI, SNAPSHOT_TYPE} from "../../Utils/Constants.js";
import { GetGuildSnapshot, ParseStoredSnapshotID } from "../../Services/SnapshotLookup.js";
import { TOS_FEATURES } from "../../TOSConstants.js";
import { GUILD_FEATURES } from "../../Typings/DatabaseTypes.js";
import { DiscordPermissions } from "../../Utils/DiscordConstants.js";

// snapshot-delete_0
// snapshot-delete_0_confirm

const NOT_FOUND = {
	embeds: [{
		color: COLOR.ERROR,
		description: 'Snapshot no longer exists - was it already deleted?'
	}],
	components: []
} satisfies InteractionResponse;

const PINNED = {
	embeds: [{
		color: COLOR.ERROR,
		description: `${EMOJI.ERROR} This snapshot is pinned and cannot be deleted. Please unpin it first.`
	}],
	components: []
} satisfies InteractionResponse;

export default {
	tos_features  : [ TOS_FEATURES.SERVER_SNAPSHOTS ],
	guild_features: [ GUILD_FEATURES.MANAGE_SNAPSHOTS ],
	permissions   : [ DiscordPermissions.Administrator ],
	response_type : 'update',
	hidden        : false,
	customID      : 'snapshot-delete',
	execute       : async function (interaction, client, args) {
		const snapshotID = ParseStoredSnapshotID(args[0]);
		const confirm = args[1] === 'confirm';

		const snapshot = snapshotID === null ? null : await GetGuildSnapshot(interaction.guildId!, args[0]);
		// Imports are never deletable - and an import id is never parsed as a stored one
		if (snapshotID === null || !snapshot || snapshot.type === SNAPSHOT_TYPE.IMPORT) return NOT_FOUND;
		if (snapshot.pinned) return PINNED;

		if (confirm) {
			try {
				await DeleteSnapshot(snapshotID);
			} catch (error) {
				// Pinned or deleted by someone else since the check above
				const current = await GetGuildSnapshot(interaction.guildId!, args[0]);
				if (!current) return NOT_FOUND;
				if ('pinned' in current && current.pinned) return PINNED;
				throw error;
			}

			return {
				embeds: [{
					color: COLOR.PRIMARY,
					description: `${EMOJI.DELETE} The snapshot has been deleted`
				}],
				components: [{
					type: 1,
					components: [{
						type: 2,
						style: 2,
						label: 'Back',
						custom_id: 'snapshot-list',
					}]
				}]
			}
		}

		return {
			embeds: [{
				color: COLOR.ERROR,
				title: `Deleting snapshot #${snapshotID}`,
				description: `
Are you sure you want to delete this snapshot?
**This action cannot be undone!**

| Channels: ${snapshot.channels.size}
| Roles: ${snapshot.roles.size}
| Bans: ${snapshot.bans.size}
| Created at <t:${~~(snapshot.created_at.getTime() / 1000)}:d>`
			}],
			components: [{
				type: 1,
				components: [
					{
						type: 2,
						style: 4,
						label: 'Confirm',
						custom_id: `snapshot-delete_${snapshotID}_confirm`,
					},
					{
						type: 2,
						style: 3,
						label: 'Take me back!',
						custom_id: `snapshot-manage_${snapshotID}`
					},
				]
			}]
		}
	}
} satisfies ButtonHandler as ButtonHandler;