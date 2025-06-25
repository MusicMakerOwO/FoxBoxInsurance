module.exports = {
	customID: 'import-view',
	execute: async function(interaction, client, args) {
		const importID = args[0];

		const managed = args[1] || '';

		const buttons = {
			type: 1,
			components: [
				{
					type: 2,
					style: 2,
					custom_id: managed ? `snapshot-manage_${importID}_${managed}` : `import_${importID}`,
					emoji: '◀️'
				},
				{
					type: 2,
					style: 2,
					custom_id: `import-view-channels_${importID}_${managed}`,
					label: 'Channels',
					emoji: '💬'
				},
				{
					type: 2,
					style: 2,
					custom_id: `import-view-roles_${importID}_${managed}`,
					label: 'Roles',
					emoji: '👥'
				},
				{
					type: 2,
					style: 2,
					custom_id: `import-view-bans_${importID}_${managed}`,
					label: 'Bans',
					emoji: '🚫'
				}
			]
		}

		interaction.update({ components: [buttons] });
	}
}