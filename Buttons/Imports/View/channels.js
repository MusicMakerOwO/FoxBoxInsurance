const { COLOR, EMOJI } = require("../../../Utils/Constants");
const RemoveFormatting = require("../../../Utils/RemoveFormatting");

const channelCache = new Map(); // import_id -> channel[]

const PAGE_SIZE = 25; // Not used here, but can be useful for pagination in the future

const NoImportEmbed = {
	color: COLOR.ERROR,
	description: 'Import has expired - Please re-import the snapshot'
}

module.exports = {
	customID: 'import-view-channels',
	execute: async function(interaction, client, args) {
		const importID = args[0];

		const page = parseInt(args[1]) || 0;
		if (isNaN(page) || page < 0) throw new Error('Invalid page number provided.');

		await interaction.deferUpdate({ ephemeral: true }).catch(() => { });

		const importData = client.ttlcache.get(`import-${importID}`);
		if (!importData) {
			return interaction.editReply({
				embeds: [NoImportEmbed],
				components: []
			});
		}

		if (!channelCache.has(importID)) {
			// It unfortunately makes a copy of the array
			// But I don't like the idea mutating the original data :/
			const sorted = Array.from( importData.data.channels ).sort( (c1, c2) => c1.name.localeCompare(c2.name) );

			channelCache.set(importID, sorted);
		}
		
		const channels = channelCache.get(importID);

		const embed = {
			color: COLOR.PRIMARY,
			title: `Import #${importData.metadata.snapshot_id} (Channels)`,
			description: '',
			footer: {
				text: `Total Channels: ${channels.length}`
			}
		}

		if (channels.length === 0) {
			embed.description = 'No channels found in this import :(';
		} else {
			const selectedChannels = channels.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
			if (selectedChannels.length === 0) {
				embed.description = 'No more channels to display on this page.';
			} else {
				embed.description = selectedChannels.map(channel => 
					'#' + RemoveFormatting(channel.name)
				).join('\n');
			}
		}

		const navButtons = {
			type: 1,
			components: [
				{
					type: 2,
					style: 2,
					custom_id: `import-view-channels_${importID}_0_`,
					emoji: EMOJI.FIRST_PAGE,
					disabled: page === 0
				},
				{
					type: 2,
					style: 2,
					custom_id: `import-view-channels_${importID}_${page - 1}`,
					emoji: EMOJI.PREVIOUS_PAGE,
					disabled: page === 0
				},
				{
					type: 2,
					style: 2,
					custom_id: 'null',
					label: `Page ${page + 1} / ${Math.ceil(channels.length / PAGE_SIZE)}`,
					disabled: true
				},
				{
					type: 2,
					style: 2,
					custom_id: `import-view-channels_${importID}_${page + 1}`,
					emoji: EMOJI.NEXT_PAGE,
					disabled: (page + 1) * PAGE_SIZE >= channels.length
				},
				{
					type: 2,
					style: 2,
					custom_id: `import-view-channels_${importID}_${~~(channels.length / PAGE_SIZE)}_`,
					emoji: EMOJI.LAST_PAGE,
					disabled: (page + 1) * PAGE_SIZE >= channels.length
				}
			]
		}

		const backButton = {
			type: 1,
			components: [
				{
					type: 2,
					style: 4,
					custom_id: `import_${importID}`,
					label: 'Back'
				}
			]
		}

		return interaction.editReply({
			embeds: [embed],
			components: channels.length > PAGE_SIZE ? [navButtons, backButton] : [backButton]
		});
	}
}