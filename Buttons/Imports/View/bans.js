const { COLOR, EMOJI } = require("../../../Utils/Constants");
const RemoveFormatting = require("../../../Utils/RemoveFormatting");

const banCache = new Map(); // import_id -> { user_id, reason }[]

const PAGE_SIZE = 25; // Not used here, but can be useful for pagination in the future

const NoImportEmbed = {
	color: COLOR.ERROR,
	description: 'Import has expired - Please re-import the snapshot'
}

const NoPermissionEmbed = {
	color: COLOR.ERROR,
	title: 'Missing Permissions',
	description: 'You must be a server administrator for this'
}

function ShortText(text = '', maxLength = 100) {
	if (text.length <= maxLength) return text;
	return text.slice(0, maxLength - 3).trim() + '...';
}

module.exports = {
	customID: 'import-view-bans',
	execute: async function(interaction, client, args) {
		const importID = args[0];
		const managed = args[1] || '';

		const page = parseInt(args[2]) || 0;
		if (isNaN(page) || page < 0) throw new Error('Invalid page number provided.');

		await interaction.deferUpdate({ ephemeral: true }).catch(() => { });

		if (!interaction.member.permissions.has('Administrator')) {
			return interaction.editReply({
				embeds: [NoPermissionEmbed],
				components: []
			});
		}

		const importData = client.ttlcache.get(`import-${importID}`);
		if (!importData) {
			return interaction.editReply({
				embeds: [NoImportEmbed],
				components: []
			});
		}

		if (!banCache.has(importID)) {
			// It unfortunately makes a copy of the array
			// But I don't like the idea mutating the original data :/
			const sorted = Array.from( importData.data.bans ).sort( (b1, b2) => BigInt(b1.user_id) < BigInt(b2.user_id) ? -1 : 1 );

			banCache.set(importID, sorted);
		}
		
		const bans = banCache.get(importID);

		const embed = {
			color: COLOR.PRIMARY,
			title: `Import #${importData.metadata.snapshot_id} (Bans)`,
			description: '',
			footer: {
				text: `Total Bans: ${bans.length}`
			}
		}

		if (bans.length === 0) {
			embed.description = 'No bans found in this import :(';
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
					custom_id: `import-view-bans_${importID}_${managed}_0_`,
					emoji: EMOJI.FIRST_PAGE,
					disabled: page === 0
				},
				{
					type: 2,
					style: 2,
					custom_id: `import-view-bans_${importID}_${managed}_${page - 1}`,
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
					custom_id: `import-view-bans_${importID}_${managed}_${page + 1}`,
					emoji: EMOJI.NEXT_PAGE,
					disabled: (page + 1) * PAGE_SIZE >= bans.length
				},
				{
					type: 2,
					style: 2,
					custom_id: `import-view-bans_${importID}_${managed}_${~~(bans.length / PAGE_SIZE)}_`,
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
					custom_id: managed ? `snapshot-manage_${importID}` : `import_${importID}`,
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