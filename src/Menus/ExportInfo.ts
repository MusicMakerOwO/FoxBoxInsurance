import {COLOR, FORMAT_NAMES} from "../Utils/Constants";
import {Database} from "../Database";
import {SelectMenuHandler} from "../Typings/HandlerTypes";
import {SimpleMessageExport} from "../Typings/DatabaseTypes";

const NoExportEmbed = {
	color: COLOR.ERROR,
	description: 'No export found with that ID'
}

export default {
	tos_features  : [],
	guild_features: [],
	permissions   : [],
	response_type : 'reply',
	hidden        : true,
	customID      : 'exportInfo',
	execute       : async function(interaction) {
		const connection = await Database.getConnection();

		const exportID = interaction.values[0];
		const exportData = await connection.query(`SELECT * FROM Exports WHERE id = ?`, [exportID]).then(x => x[0]) as SimpleMessageExport | null;
		if (!exportData) {
			Database.releaseConnection(connection);
			return { embeds: [NoExportEmbed], components: [] }
		}

		const guild_name   = await connection.query(`SELECT name FROM Guilds   WHERE id = ?`, [exportData.guild_id  ]).then(res => res[0]?.name || 'Unknown Guild'  ) as string;
		const channel_name = await connection.query(`SELECT name FROM Channels WHERE id = ?`, [exportData.channel_id]).then(res => res[0]?.name || 'Unknown Channel') as string;

		Database.releaseConnection(connection);

		const embed = {
			color: COLOR.PRIMARY,
			description: `
**Export ID:** ${exportData.id}

**Guild** : ${guild_name} (${exportData.guild_id})
**Channel** : #${channel_name} (${exportData.channel_id})

**Messages** : ${exportData.message_count}
**Format** : ${FORMAT_NAMES[exportData.format] || 'Unknown'}

**Created At** : <t:${Math.floor(exportData.created_at.getTime() / 1000)}:f>`
		}

		return { embeds: [embed], components: [] }
	}
} satisfies SelectMenuHandler as SelectMenuHandler;