const { COLOR, EMOJI } = require("../../../Utils/Constants");
const { FetchSnapshot } = require("../../../Utils/SnapshotUtils");
const RemoveFormatting = require("../../../Utils/RemoveFormatting");

const banCache = new Map(); // snapshot_id -> { user_id, reason }[]

function ShortText(text = '', maxLength = 100) {
	if (text.length <= maxLength) return text;
	return text.slice(0, maxLength - 3).trim() + '...';
}

module.exports = {
	customID: 'snapshot-view-bans',
	execute: async function(interaction, client, args) {
		const snapshotID = parseInt(args[0]);
		if (isNaN(snapshotID) || snapshotID <= 0) throw new Error('Invalid snapshot ID provided.');0

		await interaction.deferUpdate({ ephemeral: true }).catch(() => { });

		if (!banCache.has(snapshotID)) {
			const snapshotData = FetchSnapshot(snapshotID);

			const bans = Array.from( snapshotData.bans.values() );

			const sorted = bans.sort((b1, b2) => BigInt(b1.user_id) < BigInt(b2.user_id) ? -1 : 1);

			banCache.set(snapshotID, sorted);
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
			embed.description = bans.map(ban => 
				RemoveFormatting(`<@${ban.user_id}> (${ban.user_id}) - ${ShortText(ban.reason || 'No reason provided', 50)}`)
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