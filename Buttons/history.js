const { COLOR, EMOJI } = require("../Utils/Constants");
const Database = require("../Utils/Database");

const PAGE_SIZE = 5;

module.exports = {
	customID: 'history',
	execute: async function(interaction, client, args) {
		let page = args[0];

		await interaction.deferUpdate().catch(() => {});

		const connection = await Database.getConnection();

		const exportCount = await connection.query(`SELECT COUNT(*) FROM Exports WHERE user_id = ?`, [interaction.user.id]);

		if (page === 'first') {
			page = 0;
		} else if (page === 'last') {
			page = Math.ceil(exportCount / PAGE_SIZE) - 1;
		} else {
			page = parseInt(page);
			if (isNaN(page) || page < 0) page = 0;
		}

		const exports = await connection.query(`SELECT * FROM Exports WHERE user_id = ? ORDER BY created_at DESC LIMIT ${PAGE_SIZE} OFFSET (? * ${PAGE_SIZE})`, [interaction.user.id, page]); // 0-5, 6-10, 11-15, etc.

		Database.releaseConnection(connection);

		const embed = {
			color: COLOR.PRIMARY,
			title: `Export History (${exportCount} total)`,
			description: ''
		};

		const guilds = new Map();
		const channels = new Map();

		const dropdown = {
			type: 1,
			components: [{
				type: 3,
				custom_id: 'exportInfo',
				placeholder: 'Select an export to view',
				options: []
			}]
		}

		for (const exportData of exports) {
			dropdown.components[0].options.push({
				label: `Export ID: ${exportData.id}`,
				value: exportData.id,
				emoji: EMOJI.EXPORT
			});
			if (!guilds.has(exportData.guild_id)) {
				const guild = Database.prepare(`SELECT name FROM Guilds WHERE id = ?`).pluck().get(exportData.guild_id);
				guilds.set(exportData.guild_id, guild);
			}
			if (!channels.has(exportData.channel_id)) {
				const channel = Database.prepare(`SELECT name FROM Channels WHERE id = ?`).pluck().get(exportData.channel_id);
				channels.set(exportData.channel_id, channel);
			}
			const guild = guilds.get(exportData.guild_id);
			const channel = channels.get(exportData.channel_id);
			embed.description += `
**Export ID:** \`${exportData.id}\`
${guild} - #${channel}
<t:${Math.floor(new Date(exportData.created_at).getTime() / 1000)}:D>
`
		}

		const navButtons = {
			type: 1,
			components: [
				{
					type: 2,
					style: 2,
					custom_id: 'history_first',
					disabled: page === 0,
					emoji: EMOJI.FIRST_PAGE
				},
				{
					type: 2,
					style: 2,
					custom_id: `history_${page - 1}`,
					disabled: page === 0,
					emoji: EMOJI.PREVIOUS_PAGE
				},
				{
					type: 2,
					style: 4,
					custom_id: 'null',
					disabled: true,
					label: `${page + 1} / ${Math.ceil(exportCount / PAGE_SIZE)}`
				},
				{
					type: 2,
					style: 2,
					custom_id: `history_${page + 1}`,
					disabled: page + 1 >= Math.ceil(exportCount / PAGE_SIZE),
					emoji: EMOJI.NEXT_PAGE
				},
				{
					type: 2,
					style: 2,
					custom_id: 'history_last',
					disabled: page + 1 >= Math.ceil(exportCount / PAGE_SIZE),
					emoji: EMOJI.LAST_PAGE
				}
			]
		}

		interaction.editReply({ embeds: [embed], components: [dropdown, navButtons] });
	}
}