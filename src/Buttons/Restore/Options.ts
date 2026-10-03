import { ButtonHandler } from "../../Typings/HandlerTypes.js";
import { COLOR, EMOJI, SNAPSHOT_TYPE } from "../../Utils/Constants.js";
import { GetGuildSnapshot } from "../../Services/SnapshotLookup.js";
import { TOS_FEATURES } from "../../TOSConstants.js";
import { DiscordActionRow, DiscordStringSelect } from "../../Typings/DiscordTypes.js";
import { GUILD_FEATURES } from "../../Typings/DatabaseTypes.js";
import { DiscordPermissions } from "../../Utils/DiscordConstants.js";
import { SnapshotLabel } from "../../Utils/Snapshots/SnapshotLabel.js";
import { IsRestoreRunning } from "../../Services/RestoreRunner.js";

export default {
	tos_features  : [ TOS_FEATURES.SERVER_SNAPSHOTS ],
	guild_features: [ GUILD_FEATURES.RESTORE_SNAPSHOTS ],
	permissions   : [ DiscordPermissions.Administrator ],
	response_type : 'reply',
	hidden        : true,
	customID      : 'restore-options',
	execute       : async function(interaction, client, args) {
		const id = args[0];

		if (IsRestoreRunning(interaction.guildId!)) {
			return {
				embeds: [{
					color: COLOR.ERROR,
					title: 'Restore In Progress',
					description: `This server is already being restored. Wait for it to finish - the step log is posted in the channel it was started from.`
				}]
			}
		}

		const snapshotData = await GetGuildSnapshot(interaction.guildId!, id);
		if (!snapshotData) {
			return {
				embeds: [{
					color: COLOR.ERROR,
					title: 'Snapshot Not Found',
					description: `Snapshot not found or already deleted\nCreate one using \`/snapshot create\``
				}]
			}
		}

		// All three, not any - a bot holding only one of them would walk the entire flow and then
		// fail every action outside that one category once the run had already started
		const botMember = interaction.guild!.members.me;
		const missing = ([
			[ DiscordPermissions.ManageChannels, 'Manage Channels' ],
			[ DiscordPermissions.ManageRoles   , 'Manage Roles'    ],
			[ DiscordPermissions.BanMembers    , 'Ban Members'     ],
		] as const).filter(([ permission ]) => !botMember?.permissions.has(permission));

		if (missing.length > 0) {
			return {
				embeds: [{
					color: COLOR.ERROR,
					title: 'Missing Permissions',
					description: `
I need \`Manage Channels\`, \`Manage Roles\`, and \`Ban Members\` to restore this server.

**Missing:** ${missing.map(([ , name ]) => `\`${name}\``).join(', ')}`
				}]
			}
		}

		const label = SnapshotLabel(snapshotData);

		const dropdown: DiscordActionRow<DiscordStringSelect> = {
			type: 1,
			components: [{
				type: 3,
				custom_id: `restore-preset_${id}`,
				options: [
					{ label: 'Full Restore', value: 'full', description: 'Channels, roles, and bans', emoji: { name: EMOJI.RESTORE } },
					{ label: 'Structure Only', value: 'structure', description: 'Channels and roles, no bans', emoji: { name: '🏗️' } },
					{ label: 'Bans Only', value: 'bans', description: 'Only restore the ban list', emoji: { name: '🚫' } },
					{ label: 'Custom', value: 'custom', description: 'Choose exactly what to restore', emoji: { name: '⚙️' } },
				]
			}]
		}

		return {
			embeds: [{
				color: COLOR.PRIMARY,
				title: `Restore ${label}`,
				description: `
Restoring will roll your server back to match this ${snapshotData.type === SNAPSHOT_TYPE.IMPORT ? 'import' : 'snapshot'} - creating, updating, and deleting channels, roles, and bans until the server matches.
${snapshotData.type === SNAPSHOT_TYPE.IMPORT ? '\nThis import may have come from a different server. If it did, IDs won\'t match anything here, so this will delete and recreate channels, roles, and bans rather than update them in place.\n' : ''}
**This is destructive.** Nothing changes until you confirm on a later screen - pick a scope below to preview exactly what would happen.`
			}],
			components: [dropdown]
		}
	}
} satisfies ButtonHandler as ButtonHandler;
