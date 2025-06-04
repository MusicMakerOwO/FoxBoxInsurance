const { COLOR } = require("../../../Utils/Constants");
const { FetchSnapshot } = require("../../../Utils/SnapshotUtils");
const SortChannels = require("../../../Utils/Sort/SortChannels");
const RemoveFormatting = require("../../../Utils/RemoveFormatting");

const channelCache = new Map(); // snapshot_id -> string[]

module.exports = {
	customID: 'snapshot-view-channels',
	execute: async function(interaction, client, args) {
		const snapshotID = parseInt(args[0]);
		if (isNaN(snapshotID) || snapshotID <= 0) throw new Error('Invalid snapshot ID provided.');0

		await interaction.deferUpdate({ ephemeral: true }).catch(() => { });

		if (!channelCache.has(snapshotID)) {
			const snapshotData = FetchSnapshot(snapshotID);

			const channels = Array.from( snapshotData.channels.values() );

			const sorted = SortChannels(channels);

			channelCache.set(snapshotID, sorted.map(channel => {
				return {
					id: channel.id,
					name: channel.name,
					type: channel.type,
					position: channel.position
				};
			}));
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
			embed.description = channels.map(channel =>
				RemoveFormatting(`#${channel.name} (${channel.id})`)
			).join('\n');
		}

		const buttons = {
			type: 1,
			components: [
				{
					type: 2,
					style: 2,
					custom_id: `snapshot-manage_${snapshotID}`,
					emoji: '◀️'
				}
			]
		}

		interaction.editReply({
			embeds: [embed],
			components: [buttons]
		});
	}
}