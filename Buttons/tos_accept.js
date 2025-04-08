const { COLOR } = require("../Utils/Constants");
const Database = require("../Utils/Database")

const FINISH_EMBED = {
	color: COLOR.PRIMARY,
	description: `
**Thank you for accepting the terms of service.**
Please run the last command again to get started.`
}

module.exports = {
	bypass: true,
	customID: 'tos-accept',
	execute: async function(interaction, client, args) {
		Database.prepare(`UPDATE Users SET accepted_terms = 1 WHERE id = ?`).run(interaction.user.id);
		await interaction.update({ embeds: [FINISH_EMBED], components: [] }).catch(() => {});
	}
}