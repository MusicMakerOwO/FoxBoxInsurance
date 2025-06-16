module.exports = {
	customID: 'snapshot-view',
	execute: async function(interaction, client, args) {
		const snapshotID = parseInt(args[0]);
		if (isNaN(snapshotID) || snapshotID <= 0) throw new Error('Invalid snapshot ID provided.');

		const buttons = {
			type: 1,
			components: [
				{
					type: 2,
					style: 2,
					custom_id: `snapshot-manage_${snapshotID}`,
					emoji: '◀️'
				},
				{
					type: 2,
					style: 2,
					custom_id: `snapshot-view-channels_${snapshotID}`,
					label: 'Channels',
					emoji: '💬'
				},
				{
					type: 2,
					style: 2,
					custom_id: `snapshot-view-roles_${snapshotID}`,
					label: 'Roles',
					emoji: '👥'
				},
				{
					type: 2,
					style: 2,
					custom_id: `snapshot-view-bans_${snapshotID}`,
					label: 'Bans',
					emoji: '🚫'
				}
			]
		}

		interaction.update({ components: [buttons] });
	}
}