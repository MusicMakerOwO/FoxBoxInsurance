const { COLOR, EMOJI } = require("../../Utils/Constants");
const Database = require("../../Utils/Database");
const { SnapshotStats, DeleteSnapshot } = require("../../Utils/SnapshotUtils");

const ownerEmbed = {
	color: COLOR.ERROR,
	title: 'Missing Permissions',
	description: 'Only the server owner can use this command'
}

const successEmbed = {
	color: COLOR.PRIMARY,
	description: `${EMOJI.DELETE} The snapshot has been deleted`
}

// snapshot-delete_0
// snapshot-delete_0_confirm

module.exports = {
	customID: 'snapshot-delete',
	execute: async function (interaction, client, args) {
		if (interaction.guild.ownerId !== interaction.user.id) {
			return interaction.reply({ embeds: [ownerEmbed], ephemeral: true });
		}

		await interaction.deferUpdate({ ephemeral: true }).catch(() => { });

		const snapshotID = parseInt(args[0]);
		const confirm = args[1] === 'confirm';

		if (confirm) {

			DeleteSnapshot(snapshotID);

			await interaction.editReply({
				embeds: [successEmbed],
				components: []
			})

			await new Promise(resolve => setTimeout(resolve, 2000));

			const listButton = client.buttons.get('snapshot-list');
			return listButton.execute(interaction, client, []);
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
		}

		interaction.editReply({
			embeds: [embed],
			components: [confirmButtons]
		})
	}
}