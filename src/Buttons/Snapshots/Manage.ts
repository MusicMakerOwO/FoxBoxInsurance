import {ButtonHandler} from "../../Typings/HandlerTypes";
import {COLOR, EMOJI, SNAPSHOT_TYPE} from "../../Utils/Constants";
import {GetImportsForGuild} from "../../CRUD/SnapshotImports";
import {GetSnapshot} from "../../CRUD/Snapshots";
import { TOS_FEATURES } from "../../TOSConstants";
import { DiscordActionRow, DiscordButton } from "../../Typings/DiscordTypes";
import { GUILD_FEATURES } from "../../Typings/DatabaseTypes";
import { DiscordPermissions } from "../../Utils/DiscordConstants";

export default {
	tos_features  : [ TOS_FEATURES.SERVER_SNAPSHOTS ],
	guild_features: [ GUILD_FEATURES.MANAGE_SNAPSHOTS ],
	permissions   : [ DiscordPermissions.Administrator ],
	response_type : 'update',
	hidden        : false,
	customID      : 'snapshot-manage',
	execute       : async function(interaction, client, args) {
		const snapshotID = args[0];

		const importedSnapshots = GetImportsForGuild(interaction.guildId!);
		const snapshotData = importedSnapshots.get(snapshotID) ?? await GetSnapshot( parseInt(snapshotID) );
		if (!snapshotData) {
			return {
				embeds: [{
					color: COLOR.ERROR,
					title: 'Snapshot Not Found',
					description: `
Snapshot not found or already deleted
Create one using \`/snapshot create\``
				}],
				components: []
			}
		}

		const embed = {
			color: COLOR.PRIMARY,
			title: '',
			description: snapshotData.type === SNAPSHOT_TYPE.IMPORT
				? `
| Channels: ${snapshotData.channels.length}
| Roles: ${snapshotData.roles.length}
| Bans: ${snapshotData.bans.length}`.trim()
			: `
| Channels: ${snapshotData.channels.size}
| Roles: ${snapshotData.roles.size}
| Bans: ${snapshotData.bans.size}`.trim()
		}

		if (snapshotData.type === SNAPSHOT_TYPE.IMPORT) {
			embed.title = `Import #${snapshotData.id}`;
			embed.description += `\n| Expires <t:${Math.floor(snapshotData.expires_at / 1000)}:R>`
		} else {
			embed.title = `Snapshot #${snapshotData.id}`;
			embed.description += `\n| Created at <t:${Math.floor(new Date(snapshotData.created_at).getTime() / 1000)}:d>`
		}

		if (snapshotData.type !== SNAPSHOT_TYPE.IMPORT && snapshotData.pinned) {
			embed.description += ` \n| ${EMOJI.PIN} Pinned`;
		}

		const viewButtons: DiscordActionRow<DiscordButton> = {
			type: 1,
			components: [
				{
					type: 2,
					style: 2,
					label: 'View',
					custom_id: snapshotData.type === SNAPSHOT_TYPE.IMPORT ? `import-view_${snapshotData.id}_1` : `snapshot-view_${snapshotData.id}`,
					emoji: { name: EMOJI.SEARCH }
				},
				{
					type: 2,
					style: 2,
					label: 'Download',
					custom_id: `snapshot-export_${snapshotData.id}`,
					emoji: { name: EMOJI.EXPORT },
					disabled: snapshotData.type === SNAPSHOT_TYPE.IMPORT // imports cannot be downloaded
				},
				{
					type: 2,
					style: 2,
					label: 'pinned' in snapshotData && snapshotData.pinned ? 'Unpin' : 'Pin',
					custom_id: `snapshot-pin_${snapshotData.id}`,
					emoji: { name: EMOJI.PIN },
					disabled: snapshotData.type === SNAPSHOT_TYPE.IMPORT // imports cannot be pinned
				},
			]
		}

		const manageButtons: DiscordActionRow<DiscordButton> = {
			type: 1,
			components: [
				{
					type: 2,
					style: 2,
					custom_id: `snapshot-list`,
					emoji: { name: EMOJI.PREVIOUS_PAGE }
				},
				{
					type: 2,
					style: 3,
					label: 'Restore',
					custom_id: `restore-options_${snapshotData.id}`,
					emoji: { name: '🔄' },
					// TODO: Coming soon!
					disabled: true,
				},
				{
					type: 2,
					style: 4,
					label: 'Delete',
					custom_id: `snapshot-delete_${snapshotData.id}`,
					emoji: { name: EMOJI.DELETE },
					disabled: snapshotData.type === SNAPSHOT_TYPE.IMPORT || !!snapshotData.pinned // imports and pinned snapshots cannot be deleted
				},
			]
		}

		return {
			embeds: [embed],
			components: [viewButtons, manageButtons]
		}
	}
} as ButtonHandler;