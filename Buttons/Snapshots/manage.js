const { COLOR, EMOJI } = require("../../Utils/Constants");
const Database = require("../../Utils/Database");
const { SnapshotStats } = require("../../Utils/SnapshotUtils");

const NoSnapshotEmbed = {
	color: COLOR.ERROR,
	title: 'Snapshot Not Found',
	description: `
Snapshot not found or already deleted
Create one using \`/snapshot create\``
}

const noPermissionEmbed = {
	color: COLOR.ERROR,
	title: 'Missing Permissions',
	description: 'You must be a server administrator for this'
}

module.exports = {
	customID: 'snapshot-manage',
	execute: async function(interaction, client, args) {
		await interaction.deferUpdate({ ephemeral: true }).catch(() => { });

		if (!interaction.member.permissions.has('Administrator')) {
			return interaction.editReply({
				embeds: [noPermissionEmbed],
				components: []
			});
		}

		const snapshotID = parseInt(args[0]);

		const exists = Database.prepare(`
			SELECT id
			FROM Snapshots
			WHERE id = ?
			AND guild_id = ?
		`).get(snapshotID, interaction.guild.id);
		if (!exists) {
			return interaction.editReply({
				embeds: [ NoSnapshotEmbed ],
				components: []
			});
		}

		const stats = SnapshotStats(snapshotID);
		const embed = {
			color: COLOR.PRIMARY,
			title: `Snapshot #${snapshotID}`,
			description: `
| Channels: ${stats.channels}
| Roles: ${stats.roles}
| Bans: ${stats.bans}
Created at <t:${Math.floor(new Date(stats.created_at).getTime() / 1000)}:d>
`,
		}

		const viewButtons = {
			type: 1,
			components: [
				{
					type: 2,
					style: 2,
					label: 'View',
					custom_id: `snapshot-view_${snapshotID}`,
					disabled: stats.deleted === 1,
					emoji: '🔍'
				},
				{
					type: 2,
					style: 2,
					label: 'Download',
					custom_id: `snapshot-export_${snapshotID}`,
					disabled: stats.deleted === 1,
					emoji: '📥'
				},
				{
					type: 2,
					style: 2,
					label: 'Pin',
					custom_id: `snapshot-pin_${snapshotID}`,
					disabled: stats.deleted === 1,
					emoji: '📌'
				},
			]
		}

		const manageButtons = {
			type: 1,
			components: [
				{
					type: 2,
					style: 3,
					label: 'Restore',
					custom_id: `snapshot-restore_${snapshotID}`,
					disabled: stats.deleted === 1,
					emoji: '🔄'
				},
				{
					type: 2,
					style: 4,
					label: 'Delete',
					custom_id: `snapshot-delete_${snapshotID}`,
					disabled: stats.deleted === 1,
					emoji: EMOJI.DELETE
				},
			]
		}

		return interaction.editReply({
			embeds: [embed],
			components: [viewButtons, manageButtons]
		});
	}
}