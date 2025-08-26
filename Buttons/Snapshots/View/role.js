const { COLOR, EMOJI } = require("../../../Utils/Constants");
const { FetchSnapshot } = require("../../../Utils/SnapshotUtils");
const SortRoles = require("../../../Utils/Sort/SortRoles");
const RemoveFormatting = require("../../../Utils/RemoveFormatting");

const roleCache = new Map(); // snapshot_id -> role[]

const PAGE_SIZE = 25;

const NoPermissionEmbed = {
	color: COLOR.ERROR,
	title: 'Missing Permissions',
	description: 'You must be a server administrator for this'
}

module.exports = {
	customID: 'snapshot-view-roles',
	execute: async function(interaction, client, args) {

		if (!interaction.member.permissions.has('Administrator')) {
			return interaction.editReply({
				embeds: [NoPermissionEmbed],
				components: []
			});
		}

		const snapshotID = parseInt(args[0]);
		if (isNaN(snapshotID) || snapshotID <= 0) throw new Error('Invalid snapshot ID provided.');

		const page = parseInt(args[1]) || 0;
		if (isNaN(page) || page < 0) throw new Error('Invalid page number provided.');

		await interaction.deferUpdate({ ephemeral: true }).catch(() => { });

		if (!roleCache.has(snapshotID)) {
			const snapshotData = await FetchSnapshot(snapshotID);

			const roles = Array.from( snapshotData.roles.values() );

			const sorted = SortRoles(roles);

			roleCache.set(snapshotID, sorted);
		}

		const roles = roleCache.get(snapshotID);

		const embed = {
			color: COLOR.PRIMARY,
			title: `Snapshot #${snapshotID} (Roles)`,
			description: '',
			footer: {
				text: `Total Roles: ${roles.length}`
			}
		}

		if (roles.length === 0) {
			embed.description = 'No roles found in this snapshot :(';
		} else {
			const selectedRoles = roles.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
			if (selectedRoles.length === 0) {
				embed.description = 'No more roles to display on this page.';
			} else {
				embed.description = selectedRoles.map(role =>
					`${role.managed ? EMOJI.BOT : ''} @${RemoveFormatting(role.name)}`
				).join('\n');
			}
		}

		const navButtons = {
			type: 1,
			components: [
				{
					type: 2,
					style: 2,
					custom_id: `snapshot-view-roles_${snapshotID}_0_`,
					emoji: EMOJI.FIRST_PAGE,
					disabled: page === 0
				},
				{
					type: 2,
					style: 2,
					custom_id: `snapshot-view-roles_${snapshotID}_${page - 1}`,
					emoji: EMOJI.PREVIOUS_PAGE,
					disabled: page === 0
				},
				{
					type: 2,
					style: 2,
					custom_id: 'null',
					label: `Page ${page + 1} / ${Math.ceil(roles.length / PAGE_SIZE)}`,
					disabled: true
				},
				{
					type: 2,
					style: 2,
					custom_id: `snapshot-view-roles_${snapshotID}_${page + 1}`,
					emoji: EMOJI.NEXT_PAGE,
					disabled: (page + 1) * PAGE_SIZE >= roles.length
				},
				{
					type: 2,
					style: 2,
					custom_id: `snapshot-view-roles_${snapshotID}_${~~(roles.length / PAGE_SIZE)}_`,
					emoji: EMOJI.LAST_PAGE,
					disabled: (page + 1) * PAGE_SIZE >= roles.length
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
			components: roles.length > PAGE_SIZE ? [navButtons, backButton] : [backButton]
		});
	}
}