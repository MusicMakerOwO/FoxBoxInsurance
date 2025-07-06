const { COLOR, EMOJI } = require("../../../Utils/Constants");
const { FetchSnapshot } = require("../../../Utils/SnapshotUtils");

const banCache = new Map(); // snapshot_id -> { user_id, reason }[]

function ShortText(text = '', maxLength = 100) {
	if (text.length <= maxLength) return text;
	return text.slice(0, maxLength - 3).trim() + '...';
}

const PAGE_SIZE = 25;

module.exports = {
	customID: 'snapshot-view-bans',
	execute: async function(interaction, client, args) {
		const snapshotID = parseInt(args[0]);
		if (isNaN(snapshotID) || snapshotID <= 0) throw new Error('Invalid snapshot ID provided.');

		const page = parseInt(args[1]) || 0;
		if (isNaN(page) || page < 0) throw new Error('Invalid page number provided.');

		await interaction.deferUpdate({ ephemeral: true }).catch(() => { });

		if (!banCache.has(snapshotID)) {
			const snapshotData = FetchSnapshot(snapshotID);

			const bans = Array.from( snapshotData.bans.values() );

			bans.sort((b1, b2) => BigInt(b1.user_id) < BigInt(b2.user_id) ? -1 : 1);

			banCache.set(snapshotID, bans);
		}
		
		const bans = banCache.get(snapshotID);

		const embed = {
			color: COLOR.PRIMARY,
			title: `Snapshot #${snapshotID} (Bans)`,
			description: '',
			footer: {
				text: `Total Bans: ${bans.length}`
			}
		}

		if (bans.length === 0) {
			embed.description = 'No bans found in this snapshot :(';
		} else {
			const selectedBans = bans.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
			if (selectedBans.length === 0) {
				embed.description = 'No more bans to display on this page.';
			} else {
				embed.description = selectedBans.map(ban => 
					`<@${ban.user_id}> (${ban.user_id}) - ${ShortText(ban.reason || 'No reason provided', 50)}`
				).join('\n');
			}
		}

		const navButtons = {
			type: 1,
			components: [
				{
					type: 2,
					style: 2,
					custom_id: `snapshot-view-bans_${snapshotID}_0_`,
					emoji: EMOJI.FIRST_PAGE,
					disabled: page === 0
				},
				{
					type: 2,
					style: 2,
					custom_id: `snapshot-view-bans_${snapshotID}_${page - 1}`,
					emoji: EMOJI.PREVIOUS_PAGE,
					disabled: page === 0
				},
				{
					type: 2,
					style: 2,
					custom_id: 'null',
					label: `Page ${page + 1} / ${Math.ceil(bans.length / PAGE_SIZE)}`,
					disabled: true
				},
				{
					type: 2,
					style: 2,
					custom_id: `snapshot-view-bans_${snapshotID}_${page + 1}`,
					emoji: EMOJI.NEXT_PAGE,
					disabled: (page + 1) * PAGE_SIZE >= bans.length
				},
				{
					type: 2,
					style: 2,
					custom_id: `snapshot-view-bans_${snapshotID}_${~~(bans.length / PAGE_SIZE)}_`,
					emoji: EMOJI.LAST_PAGE,
					disabled: (page + 1) * PAGE_SIZE >= bans.length
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
			components: bans.length > PAGE_SIZE ? [navButtons, backButton] : [backButton]
		});
	}
}