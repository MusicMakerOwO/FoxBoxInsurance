const { COLOR } = require("../../Utils/Constants");
const Database = require("../../Utils/Database");

const ownerEmbed = {
	color: COLOR.ERROR,
	title: 'Missing Permissions',
	description: 'Only the server owner can use this command'
}

const successEmbed = {
	color: COLOR.INFO,
	description: '🗑️ The snapshot has been deleted'
}

// snapshot-delete_0
// snapshot-delete_0_confirm

module.exports = {
	customID: 'snapshot-delete',
	execute: async function(interaction, client, args) {
		if (interaction.guild.ownerId !== interaction.user.id) {
			return interaction.reply({ embeds: [ownerEmbed], ephemeral: true });
		}

		await interaction.deferUpdate({ ephemeral: true }).catch(() => { });

		const snapshotID = parseInt(args[0]);
		const confirm = args[1] === 'confirm';

		if (confirm) {
			Database.prepare(`
				UPDATE Snapshots
				SET deleted = 1
				WHERE id = ?
				AND guild_id = ?
			`).run(snapshotID, interaction.guild.id);
			return interaction.update({
				embeds: [ successEmbed ],
				components: [],
				ephemeral: true
			}).catch(() => { });
		}

		const stats = SnapshotStats(snapshotID);

		const embed = {
			color: COLOR.ERROR,
			title: `Deleting snapshot #${snapshotID}`,
			description: `
Are you sure you want to delete this snapshot?
**This action cannot be undone!**

| Channels: ${stats.channels}
| Roles: ${stats.roles}
| Bans: ${stats.bans}
| Created at <t:${Math.floor(new Date(stats.created_at).getTime() / 1000)}:d>`
		}

		const confirmButtons = {
			type: 1,
			components: [
				{
					type: 2,
					style: 3,
					label: 'Take me back!',
					custom_id: `snapshot-manage_${snapshotID}`
				},
				{
					type: 2,
					style: 4,
					label: 'Confirm',
					custom_id: `snapshot-delete_${snapshotID}_confirm`,
				},
			]
		}

		await interaction.editReply({
			embeds: [embed],
			components: [confirmButtons],
			ephemeral: true
		}).catch(() => { });
	}
}