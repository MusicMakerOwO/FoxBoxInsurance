const { COLOR, SNAPSHOT_TYPE, SNAPSHOT_TYPE_EMOJI, EMOJI, SECONDS } = require("../../Utils/Constants");
const Database = require("../../Utils/Database");
const { SnapshotStats } = require("../../Utils/SnapshotUtils");

const NoSnapshotEmbed = {
	color: COLOR.ERROR,
	title: 'No Snapshots',
	description: `
No snapshots found for this server :(
Create one using \`/snapshot create\``
}

const noPermissionEmbed = {
	color: COLOR.ERROR,
	title: 'Missing Permissions',
	description: 'You must be a server administrator for this'
}

module.exports = {
	customID: 'snapshot-list',
	execute: async function(interaction, client, args) {

		await interaction.deferUpdate({ ephemeral: true }).catch(() => { });

		if (!interaction.member.permissions.has('Administrator')) {
			return interaction.editReply({
				embeds: [noPermissionEmbed],
				components: []
			});
		}

		const availableSnapshots = Database.prepare(`
			SELECT id, type, created_at
			FROM Snapshots
			WHERE guild_id = ?
			ORDER BY id DESC
		`).all(interaction.guild.id);
		if (availableSnapshots.length === 0) {
			return interaction.editReply({ embeds: [NoSnapshotEmbed] })
		}

		const embed = {
			color: COLOR.PRIMARY,
			title: `Snapshot List (${availableSnapshots.length})`,
			description: ''
		}

		const dropdownOptions = [];

		if (client.ttlcache.has(`guild-imports-${interaction.guild.id}`)) {
			const imports = client.ttlcache.get(`guild-imports-${interaction.guild.id}`);
			if (imports.size > 0) {
				embed.description += `> **You have ${imports.size} imports available:**\n`;
				for (const [importID, expiration] of imports.entries()) {
					const importData = client.ttlcache.get(`import-${importID}`);
					if (!importData) continue; // data might have expired

					const expiresDate = new Date(expiration);
					const expiresString = '<t:' + Math.floor(expiresDate.getTime() / 1000) + ':R>';
					
					embed.description += `> 
> ${EMOJI.IMPORT} **Import #${importData.metadata.snapshot_id}** - Expires ${expiresString}
> | Channels: ${importData.data.channels.length}
> | Roles: ${importData.data.roles.length}
> | Bans: ${importData.data.bans.length}\n`;

					dropdownOptions.push({
						label: `Import #${importData.metadata.id}`,
						value: importID,
						description: `Channels: ${importData.data.channels.length} | Roles: ${importData.data.roles.length} | Bans: ${importData.data.bans.length}`,
					});
				}
			}
		}

		for (const snapshot of availableSnapshots) {
			const date = new Date(snapshot.created_at);
			const type = SNAPSHOT_TYPE[snapshot.type] ?? 'Unknown';
			const dateString = '<t:' + Math.floor(date.getTime() / 1000) + ':d>';
			const stats = SnapshotStats(snapshot.id);
			const emoji = stats.pinned ? EMOJI.PIN : EMOJI.SNAPSHOT;

			embed.description += `
${emoji} **Snapshot #${snapshot.id}** - \`${type}\` ${SNAPSHOT_TYPE_EMOJI[snapshot.type] ?? ''}
| Channels: ${stats.channels}
| Roles: ${stats.roles}
| Bans: ${stats.bans}
Created at ${dateString}\n`;

			dropdownOptions.push({
				label: `Snapshot #${snapshot.id} - ${type}`,
				value: snapshot.id.toString(),
				description: `Channels: ${stats.channels} | Roles: ${stats.roles} | Bans: ${stats.bans}`,
			});
		}

		const guildHour = BigInt(interaction.guild.id) % 24n;
		embed.description += `**Snapshots occur once per day at <t:${Number(guildHour) * 3600 + SECONDS.HOUR}:t>**`;


		const dropdown = {
			type: 1,
			components: [{
				type: 3,
				custom_id: 'snapshot-view',
				options: dropdownOptions
			}]
		}

		await interaction.editReply({
			embeds: [embed],
			components: [dropdown]
		}).catch(() => { });

	}
}