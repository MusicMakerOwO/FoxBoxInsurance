const { COLOR } = require("../../../Utils/Constants");
const { FetchSnapshot } = require("../../../Utils/SnapshotUtils");
const SortChannels = require("../../../Utils/Sort/SortChannels");
const RemoveFormatting = require("../../../Utils/RemoveFormatting");

const channelCache = new Map(); // snapshot_id -> string[]

const PAGE_SIZE = 25; // Not used here, but can be useful for pagination in the future

module.exports = {
	customID: 'snapshot-view-channels',
	execute: async function(interaction, client, args) {
		const snapshotID = parseInt(args[0]);
		if (isNaN(snapshotID) || snapshotID <= 0) throw new Error('Invalid snapshot ID provided.');

		const page = parseInt(args[1]) || 0;
		if (isNaN(page) || page < 0) throw new Error('Invalid page number provided.');

		await interaction.deferUpdate({ ephemeral: true }).catch(() => { });

		if (!channelCache.has(snapshotID)) {
			const snapshotData = FetchSnapshot(snapshotID);

			const channels = Array.from( snapshotData.channels.values() );

			const sorted = channels.sort( (c1, c2) => c1.name.localeCompare(c2.name) );

			channelCache.set(snapshotID, sorted);
		}
		
		const channels = channelCache.get(snapshotID);

		const embed = {
			color: COLOR.PRIMARY,
			title: `Snapshot #${snapshotID} (Channels)`,
			description: '',
			footer: {
				text: `Total Channels: ${channels.length}`
			}
		}

		if (channels.length === 0) {
			embed.description = 'No channels found in this snapshot :(';
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
					custom_id: `snapshot-view-channels_${snapshotID}_0_`,
					emoji: '⏪',
					disabled: page === 0
				},
				{
					type: 2,
					style: 2,
					custom_id: `snapshot-view-channels_${snapshotID}_${page - 1}`,
					emoji: '◀️',
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
					custom_id: `snapshot-view-channels_${snapshotID}_${page + 1}`,
					emoji: '▶️',
					disabled: (page + 1) * PAGE_SIZE >= channels.length
				},
				{
					type: 2,
					style: 2,
					custom_id: `snapshot-view-channels_${snapshotID}_${~~(channels.length / PAGE_SIZE)}_`,
					emoji: '⏩',
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
					custom_id: `snapshot-manage_${snapshotID}`,
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