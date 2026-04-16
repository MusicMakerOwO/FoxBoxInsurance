import {DeleteSnapshot, GetSnapshot, IsSnapshotDeletable} from "../../CRUD/Snapshots";
import {ButtonHandler} from "../../Typings/HandlerTypes";
import {COLOR, EMOJI} from "../../Utils/Constants";
import { TOS_FEATURES } from "../../TOSConstants";
import { GUILD_FEATURES } from "../../Typings/DatabaseTypes";
import { DiscordPermissions } from "../../Utils/DiscordConstants";

// snapshot-delete_0
// snapshot-delete_0_confirm

export default {
	tos_features  : [ TOS_FEATURES.SERVER_SNAPSHOTS ],
	guild_features: [ GUILD_FEATURES.MANAGE_SNAPSHOTS ],
	permissions   : [ DiscordPermissions.Administrator ],
	response_type : 'update',
	hidden        : false,
	customID      : 'snapshot-delete',
	execute       : async function (interaction, client, args) {
		if (interaction.guild!.ownerId !== interaction.user.id) {
			return {
				embeds: [{
					color: COLOR.ERROR,
					title: 'Missing Permissions',
					description: 'Only the server owner can use this command'
				}],
				ephemeral: true
			}
		}

		const snapshotID = parseInt(args[0]);
		const confirm = args[1] === 'confirm';

		const snapshot = await GetSnapshot(snapshotID);
		if (!snapshot) {
			return {
				embeds: [{
					color: COLOR.ERROR,
					description: 'Snapshot no longer exists - was it already deleted?'
				}]
			}
		}
		if ( ! await IsSnapshotDeletable(snapshotID) ) {
			return {
				embeds: [{
					color: COLOR.ERROR,
					description: `${EMOJI.ERROR} This snapshot is pinned and cannot be deleted. Please unpin it first.`
				}],
				components: []
			}
		}

		if (confirm) {
			await DeleteSnapshot(snapshotID);

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