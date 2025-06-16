module.exports = {
	customID: 'import-view',
	execute: async function(interaction, client, args) {
		const importID = args[0];

		const buttons = {
			type: 1,
			components: [
				{
					type: 2,
					style: 2,
					custom_id: `import_${importID}`,
					emoji: '◀️'
				},
				{
					type: 2,
					style: 2,
					custom_id: `import-view-channels_${importID}`,
					label: 'Channels',
					emoji: '💬'
				},
				{
					type: 2,
					style: 2,
					custom_id: `import-view-roles_${importID}`,
					label: 'Roles',
					emoji: '👥'
				},
				{
					type: 2,
					style: 2,
					custom_id: `import-view-bans_${importID}`,
					label: 'Bans',
					emoji: '🚫'
				}
			]
		}

		interaction.update({ components: [buttons] });
	}
}