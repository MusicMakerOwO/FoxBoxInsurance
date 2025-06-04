const { COLOR, EMOJI } = require("../../../Utils/Constants");
const { FetchSnapshot } = require("../../../Utils/SnapshotUtils");
const SortRoles = require("../../../Utils/Sort/SortRoles");
const RemoveFormatting = require("../../../Utils/RemoveFormatting");

const roleCache = new Map(); // snapshot_id -> role[]

module.exports = {
	customID: 'snapshot-view-roles',
	execute: async function(interaction, client, args) {
		const snapshotID = parseInt(args[0]);
		if (isNaN(snapshotID) || snapshotID <= 0) throw new Error('Invalid snapshot ID provided.');0

		await interaction.deferUpdate({ ephemeral: true }).catch(() => { });

		if (!roleCache.has(snapshotID)) {
			const snapshotData = FetchSnapshot(snapshotID);

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
			embed.description = roles.map(role => 
				RemoveFormatting(`${role.managed ? EMOJI.BOT : ''} @${role.name} (${role.id})`)
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