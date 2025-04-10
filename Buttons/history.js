const { COLOR } = require("../Utils/Constants");
const Database = require("../Utils/Database");

const PAGE_SIZE = 5;

const History = Database.prepare(`SELECT * FROM Exports WHERE user_id = ? ORDER BY created_at DESC LIMIT ${PAGE_SIZE} OFFSET (? * ${PAGE_SIZE})`);

module.exports = {
	customID: 'history',
	execute: async function(interaction, client, args) {
		let page = args[0];
		
		await interaction.deferUpdate().catch(() => {});
		
		const exportCount = Database.prepare(`SELECT COUNT(*) FROM Exports WHERE user_id = ?`).pluck().get(interaction.user.id);

		page = parseInt(page);
		if (isNaN(page) || page < 0) page = 0;

		const exports = History.all(interaction.user.id, page); // 0-5, 6-10, 11-15, etc.

		const embed = {
			color: COLOR.PRIMARY,
			title: 'Export History',
			description: ''
		};

		const guilds = new Map();
		const channels = new Map();

		const dropdown = {
			type: 1,
			components: [{
				type: 3,
				custom_id: 'history',
				placeholder: 'Select an export to view',
				options: []
			}]
		}

		for (const exportData of exports) {
			dropdown.components[0].options.push({
				label: `Export ID: ${exportData.id}`,
				value: exportData.id,
				emoji: '📦'
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
					emoji: '⏪'
				},
				{
					type: 2,
					style: 2,
					custom_id: 'history_previous',
					disabled: page === 0,
					emoji: '◀️'
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
					custom_id: 'history_next',
					disabled: exports.length < PAGE_SIZE,
					emoji: '▶️'
				},
				{
					type: 2,
					style: 2,
					custom_id: 'history_last',
					disabled: exports.length < PAGE_SIZE,
					emoji: '⏩'
				}
			]
		}

		await interaction.editReply({ embeds: [embed], components: [dropdown, navButtons] }).catch(() => {});
	}
}