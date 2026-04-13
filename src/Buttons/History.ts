import {ButtonHandler} from "../Typings/HandlerTypes";
import {COLOR, EMOJI} from "../Utils/Constants";
import {Database} from "../Database";
import {GetGuild} from "../CRUD/Guilds";
import {GetChannel} from "../CRUD/Channels";
import {SimpleMessageExport} from "../Typings/DatabaseTypes";
import { DiscordActionRow, DiscordButton, DiscordStringSelect } from "../Typings/DiscordTypes";

const PAGE_SIZE = 5;

const NoExportsEmbed = {
	color: COLOR.ERROR,
	description: 'You have no export history - Use `/export` to get started!'
}

export default {
	tos_features  : [],
	guild_features: [],
	permissions   : [],
	response_type : 'update',
	hidden        : false,
	customID      : 'history',
	execute       : async function(interaction, client, args) {
		let input = args[0];

		const connection = await Database.getConnection();

		const exportCount = await connection.query(`SELECT COUNT(*) as count FROM Exports WHERE user_id = ?`, [interaction.user.id]).then(res => Number(res[0].count)) as number;
		if (exportCount === 0) {
			return { embeds: [NoExportsEmbed] }
		}

		let page: number;
		if (input === 'first') {
			page = 0;
		} else if (input === 'last') {
			page = Math.ceil(exportCount / PAGE_SIZE) - 1;
		} else {
			page = parseInt(input);
			if (isNaN(page) || page < 0) page = 0;
		}

		const exports = await connection.query(`
			SELECT * FROM Exports
			WHERE user_id = ?
			ORDER BY created_at DESC, id ASC
			LIMIT ${PAGE_SIZE} OFFSET ?
		`, [interaction.user.id, page * PAGE_SIZE]) as SimpleMessageExport[]; // 0-5, 6-10, 11-15, etc.

		Database.releaseConnection(connection);

		const embed = {
			color: COLOR.PRIMARY,
			title: `Export History (${exportCount} total)`,
			description: ''
		};

		const dropdown: DiscordActionRow<DiscordStringSelect> = {
			type: 1,
			components: [{
				type: 3,
				custom_id: 'exportInfo',
				options: []
			}]
		}

		for (const exportData of exports) {
			dropdown.components[0].options.push({
				label: `Export ID: ${exportData.id}`,
				value: exportData.id,
				emoji: { name: EMOJI.EXPORT }
			});
			const guild = await GetGuild(exportData.guild_id);
			const channel = await GetChannel(exportData.channel_id);
			embed.description += `
**Export ID:** \`${exportData.id}\`
${guild?.name ?? "Unknown"} - #${channel?.name ?? "Unknown"}
<t:${Math.floor(exportData.created_at)}:D>
`
		}

		const navButtons: DiscordActionRow<DiscordButton> = {
			type: 1,
			components: [
				{
					type: 2,
					style: 2,
					custom_id: 'history_first',
					disabled: page === 0,
					emoji: { name: EMOJI.FIRST_PAGE }
				},
				{
					type: 2,
					style: 2,
					custom_id: `history_${page - 1}`,
					disabled: page === 0,
					emoji: { name: EMOJI.PREVIOUS_PAGE }
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
					emoji: { name: EMOJI.NEXT_PAGE }
				},
				{
					type: 2,
					style: 2,
					custom_id: 'history_last',
					disabled: page + 1 >= Math.ceil(exportCount / PAGE_SIZE),
					emoji: { name: EMOJI.LAST_PAGE }
				}
			]
		}

		return { embeds: [embed], components: [dropdown, navButtons] }
	}
} satisfies ButtonHandler as ButtonHandler;