const { COLOR, EMOJI } = require("../../Utils/Constants");
const Database = require("../../Utils/Database");
const { ClearCache, CACHE_TYPE } = require("../../Utils/SnapshotUtils");

const PinEmbed = {
	color: COLOR.PRIMARY,
	title: 'Pin Snapshot',
	description: `
Pinning a snapshot will keep a permanent record of it in the server.
They __cannot be deleted or modified__, great for looking back at important moments!

Pinned snapshots still count towards your snapshot limit!

**Do you want to pin this snapshot?**`
}

const UnpinEmbed = {
	color: COLOR.PRIMARY,
	title: 'Unpin Snapshot',
	description: `
Unpinning a snapshot will __allow it to be deleted__.
Once a snapshot is deleted it cannot be recovered!
**Do you want to unpin this snapshot?**`
}

const pinSuccess = {
	color: COLOR.PRIMARY,
	description: `${EMOJI.TADA} The snapshot has been pinned successfully!`
}

const unpinSuccess = {
	color: COLOR.PRIMARY,
	description: `${EMOJI.DELETE} The snapshot has been unpinned successfully!`
}

module.exports = {
	customID: 'snapshot-pin',
	execute: async function(interaction, client, args) {
		const snapshotID = parseInt(args[0]);
		if (isNaN(snapshotID) || snapshotID < 1) {
			throw new Error(`Invalid snapshot ID provided: ${args[0]}`);
		}
		const confirm = args[1] === 'confirm';

		await interaction.deferUpdate({ ephemeral: true }).catch(() => { });

		if (!confirm) {
			const currentPinned = Database.prepare(`
				SELECT pinned
				FROM Snapshots
				WHERE id = ?
			`).get(snapshotID);

			const buttons = {
				type: 1,
				components: [
					currentPinned.pinned ? {
						type: 2,
						style: 4,
						label: 'Unpin Snapshot',
						custom_id: `snapshot-pin_${snapshotID}_confirm_1`,
						emoji: EMOJI.DELETE,
					} : {
						type: 2,
						style: 3,
						label: 'Pin Snapshot',
						custom_id: `snapshot-pin_${snapshotID}_confirm`,
						emoji: EMOJI.PIN,
					},
					{
						type: 2,
						style: 4,
						label: 'Cancel',
						custom_id: `snapshot-manage_${snapshotID}`
					}
				]
			}

			ClearCache(snapshotID, CACHE_TYPE.STAT);

			return interaction.editReply({
				embeds: [ currentPinned.pinned ? UnpinEmbed : PinEmbed ],
				components: [buttons]
			});
		}

		Database.prepare(`
			UPDATE Snapshots
			SET pinned = 1
			WHERE id = ?
		`).run(snapshotID);

		await interaction.editReply({
			embeds: [ args[2] ? unpinSuccess : pinSuccess ],
			components: []
		});

		await new Promise(resolve => setTimeout(resolve, 2000));

		const listButton = client.buttons.get('snapshot-manage');
		return listButton.execute(interaction, client, [snapshotID.toString()]);
	}
}