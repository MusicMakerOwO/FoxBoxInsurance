const { COLOR, EMOJI } = require("../../../Utils/Constants");
const RemoveFormatting = require("../../../Utils/RemoveFormatting");
const SortRoles = require("../../../Utils/Sort/SortRoles");

const roleCache = new Map(); // import_id -> role[]

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

module.exports = {
	customID: 'import-view-roles',
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

		if (!roleCache.has(importID)) {
			const sorted = SortRoles( importData.data.roles );

			roleCache.set(importID, sorted);
		}
		
		const roles = roleCache.get(importID);

		const embed = {
			color: COLOR.PRIMARY,
			title: `Import #${importData.metadata.snapshot_id} (Roles)`,
			description: '',
			footer: {
				text: `Total Roles: ${roles.length}`
			}
		}

		if (roles.length === 0) {
			embed.description = 'No roles found in this import :(';
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
					custom_id: `import-view-roles_${importID}_${managed}_0_`,
					emoji: EMOJI.FIRST_PAGE,
					disabled: page === 0
				},
				{
					type: 2,
					style: 2,
					custom_id: `import-view-roles_${importID}_${managed}_${page - 1}`,
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
					custom_id: `import-view-roles_${importID}_${managed}_${page + 1}`,
					emoji: EMOJI.NEXT_PAGE,
					disabled: (page + 1) * PAGE_SIZE >= roles.length
				},
				{
					type: 2,
					style: 2,
					custom_id: `import-view-roles_${importID}_${managed}_${~~(roles.length / PAGE_SIZE)}_`,
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
					custom_id: managed ? `snapshot-manage_${importID}` : `import_${importID}`,
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