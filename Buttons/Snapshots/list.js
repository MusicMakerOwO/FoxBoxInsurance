const { COLOR, SNAPSHOT_TYPE, SNAPSHOT_TYPE_EMOJI } = require("../../Utils/Constants");
const Database = require("../../Utils/Database");
const { SnapshotStats } = require("../../Utils/SnapshotUtils");

const NoSnapshotEmbed = {
	color: COLOR.ERROR,
	title: 'No Snapshots',
	description: `
No snapshots found for this server :(
Create one using \`/snapshot create\``
}

module.exports = {
	customID: 'snapshot-list',
	execute: async function(interaction, client, args) {

		await interaction.deferUpdate({ ephemeral: true }).catch(() => { });

		const availableSnapshots = Database.prepare(`
			SELECT id, type, created_at
			FROM Snapshots
			WHERE guild_id = ?
			AND deleted = 0
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

		for (const snapshot of availableSnapshots) {
			const date = new Date(snapshot.created_at);
			const type = SNAPSHOT_TYPE[snapshot.type] ?? 'Unknown';
			const dateString = '<t:' + Math.floor(date.getTime() / 1000) + ':d>';
			const stats = SnapshotStats(snapshot.id);

			embed.description += `
📦 **Snapshot #${snapshot.id}** - \`${type}\` ${SNAPSHOT_TYPE_EMOJI[snapshot.type] ?? ''}
| Channels: ${stats.channels}
| Roles: ${stats.roles}
| Bans: ${stats.bans}
Created at ${dateString}\n\n`;

			dropdownOptions.push({
				label: `Snapshot #${snapshot.id} - ${type}`,
				value: snapshot.id.toString(),
				description: `Channels: ${stats.channels} | Roles: ${stats.roles} | Bans: ${stats.bans}`,
			});
		}

		const guildHour = BigInt(interaction.guild.id) % 24n;
		embed.description += `**Snapshots occur once per day at <t:${Number(guildHour) * 3600}:t>**`;


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