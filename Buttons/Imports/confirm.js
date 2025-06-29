const { SECONDS, EMOJI, COLOR } = require("../../Utils/Constants");

const NoImportEmbed = {
	color: COLOR.ERROR,
	title: 'Import Not Found',
	description: 'The import does not exist or has expired.\nPlease import the file and try again.'
}

module.exports = {
	customID: 'import-confirm',
	execute: async function(interaction, client, args) {
		const importID = args[0];

		await interaction.deferUpdate({ ephemeral: true }).catch(() => { });

		if (!client.ttlcache.has(`import-${importID}`)) {
			return interaction.editReply({
				embeds: [ NoImportEmbed ],
				components: []
			});
		}

		if (!client.ttlcache.has(`guild-imports-${interaction.guild.id}`)) {
			client.ttlcache.set(`guild-imports-${interaction.guild.id}`, new Map([
				[importID, Date.now() + SECONDS.MINUTE * 60 * 1000 ] // importID -> expiration timestamp
			]), SECONDS.MINUTE * 60 * 1000); // Store the imports for 60 minutes
			console.log(client.ttlcache.get(`guild-imports-${interaction.guild.id}`));
		} else {
			const imports = client.ttlcache.get(`guild-imports-${interaction.guild.id}`);
			imports.set(importID, Date.now() + SECONDS.MINUTE * 60 * 1000);
		}

		const embed = {
			color: 0x00FF00,
			title: 'Snapshot Imported',
			description: `
The snapshot has been added your list, check it out with \`/snapshot list\`
It will be removed from your list <t:${~~((Date.now() + SECONDS.MINUTE * 60 * 1000) / 1000)}:R>`
		}

		const gotoButton = {
			type: 1,
			components: [{
				type: 2,
				style: 2,
				label: 'View Snapshots',
				emoji: EMOJI.OPEN,
				custom_id: 'snapshot-list'
			}]
		}

		return interaction.editReply({
			embeds: [embed],
			components: [gotoButton]
		});
	}
}