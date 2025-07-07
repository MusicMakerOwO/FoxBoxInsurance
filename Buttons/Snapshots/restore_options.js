const { RESTORE_OPTIONS, SECONDS, COLOR, SNAPSHOT_TYPE, RESTORE_OPTION_NAMES, EMOJI } = require("../../Utils/Constants");
const Database = require("../../Utils/Database");
const { SnapshotStats } = require("../../Utils/SnapshotUtils");

function DefaultOptions() {
	return RESTORE_OPTIONS.CHANNELS | RESTORE_OPTIONS.ROLES | RESTORE_OPTIONS.BANS
}

const NoSnapshotEmbed = {
	color: COLOR.ERROR,
	title: 'Snapshot Not Found',
	description: `Snapshot not found or already deleted\nCreate one using \`/snapshot create\``
}

const OwnerEmbed = {
	color: COLOR.ERROR,
	title: 'Missing Permissions',
	description: 'Only the server owner can restore snapshots'
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
	customID: 'restore-options',
	execute: async function(interaction, client, args) {

		if (interaction.guild.ownerId !== interaction.user.id) {
			return interaction.update({
				embeds: [OwnerEmbed],
				components: []
			});
		}

		const snapshot = args[0];
		const snapshotData = ResolveSnapshot(client, interaction.guild.id, snapshot);
		if (!snapshotData) {
			return interaction.update({
				embeds: [NoSnapshotEmbed]
			});
		}

		if (!client.ttlcache.has(`restore-options-${interaction.guild.id}`)) {
			client.ttlcache.set(`restore-options-${interaction.guild.id}`, DefaultOptions(), SECONDS.MINUTE * 10 * 1000);
		}

		const options = client.ttlcache.get(`restore-options-${interaction.guild.id}`);

		const title = snapshotData.type === SNAPSHOT_TYPE.IMPORT
			? `Import #${snapshotData.id}`
			: `Snapshot #${snapshotData.id}`;

		const embed = {
			color: COLOR.PRIMARY,
			title: 'Restore Options',
			description: `
What would you like to restore from this snapshot?

${title}
| **Channels**: ${snapshotData.channels}
| **Roles**: ${snapshotData.roles}
| **Bans**: ${snapshotData.bans}
`
		}

		const dropdown = {
			type: 1,
			components: [{
				type: 3,
				custom_id: `restore-options_${args.join('_')}`,
				max_values: Object.keys(RESTORE_OPTIONS).length,
				options: Object.entries(RESTORE_OPTIONS).map(([key, value]) => ({
					label: RESTORE_OPTION_NAMES[value],
					value: value.toString(),
					default: (options & value) === value
				}))
			}]
		}

		const ContinueButtons = {
			type: 1,
			components: [
				{
					type: 2,
					style: 2,
					label: 'Cancel',
					custom_id: `snapshot-manage_${snapshot}`,
					emoji: EMOJI.DELETE
				},
				{
					type: 2,
					style: 3,
					label: 'Continue',
					custom_id: `snapshot-restore_${snapshot}`
				}
			]
		}

		return interaction.update({
			embeds: [embed],
			components: [dropdown, ContinueButtons],
			ephemeral: true
		});
	}
}