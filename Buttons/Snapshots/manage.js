const { COLOR, EMOJI, SNAPSHOT_TYPE } = require("../../Utils/Constants");
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

function ResolveSnapshot(client, guildID, id) {

	const availableImports = client.ttlcache.get(`guild-imports-${guildID}`);
	if (!availableImports || !availableImports.has(id)) {
		id = parseInt(id) || 0;
		if (isNaN(id) || id <= 0) throw new Error(`Invalid snapshot ID provided : ${id}`);

		const exists = Database.prepare(`
			SELECT 1
			FROM Snapshots
			WHERE id = ?
		`).get(id);
		if (!exists) return null

		return SnapshotStats(id);
	}
	
	const importData = client.ttlcache.get(`import-${id}`);
	if (!importData) return null;

	return {
		type: SNAPSHOT_TYPE.IMPORT,
		expires_at: availableImports.get(id),
		
		id: importData.metadata.snapshot_id,
		importID: id,

		channels: importData.data.channels.length,
		roles: importData.data.roles.length,
		bans: importData.data.bans.length,
		permissions: importData.data.permissions.length,
	}
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

		const snapshot = args[0];

		const snapshotData = ResolveSnapshot(client, interaction.guild.id, snapshot);
		if (!snapshotData) {
			return interaction.editReply({
				embeds: [NoSnapshotEmbed],
				components: []
			});
		}

		const embed = {
			color: COLOR.PRIMARY,
			title: '',
			description: `
| Channels: ${snapshotData.channels}
| Roles: ${snapshotData.roles}
| Bans: ${snapshotData.bans}
`,
		}

		if (snapshotData.type === SNAPSHOT_TYPE.IMPORT) {
			embed.title = `Import #${snapshotData.id}`;
			embed.description += `| Expires <t:${Math.floor(snapshotData.expires_at / 1000)}:R>`
		} else {
			embed.title = `Snapshot #${snapshotData.id}`;
			embed.description += `| Created at <t:${Math.floor(new Date(snapshotData.created_at).getTime() / 1000)}:d>`
		}

		const viewButtons = {
			type: 1,
			components: [
				{
					type: 2,
					style: 2,
					label: 'View',
					custom_id: snapshotData.type === SNAPSHOT_TYPE.IMPORT ? `import-view_${snapshotData.importID}_1` : `snapshot-view_${snapshotData.id}`,
					// custom_id: `snapshot-view_${snapshotData.id}`,
					emoji: EMOJI.SEARCH
				},
				{
					type: 2,
					style: 2,
					label: 'Download',
					custom_id: `snapshot-export_${snapshotData.id}`,
					emoji: EMOJI.EXPORT,
					disabled: snapshotData.type === SNAPSHOT_TYPE.IMPORT // imports cannot be downloaded
				},
				{
					type: 2,
					style: 2,
					label: 'Pin',
					custom_id: `snapshot-pin_${snapshotData.id}`,
					emoji: EMOJI.PIN,
					disabled: snapshotData.type === SNAPSHOT_TYPE.IMPORT // imports cannot be pinned
				},
			]
		}

		const manageButtons = {
			type: 1,
			components: [
				{
					type: 2,
					style: 2,
					custom_id: `snapshot-list`,
					emoji: EMOJI.PREVIOUS_PAGE
				},
				{
					type: 2,
					style: 3,
					label: 'Restore',
					custom_id: `restore-options_${snapshotData.snapshotID ?? snapshotData.id}`,
					emoji: '🔄'
				},
				{
					type: 2,
					style: 4,
					label: 'Delete',
					custom_id: `snapshot-delete_${snapshotData.id}`,
					emoji: EMOJI.DELETE,
					disabled: snapshotData.type === SNAPSHOT_TYPE.IMPORT // imports cannot be deleted
				},
			]
		}

		return interaction.editReply({
			embeds: [embed],
			components: [viewButtons, manageButtons]
		});
	}
}