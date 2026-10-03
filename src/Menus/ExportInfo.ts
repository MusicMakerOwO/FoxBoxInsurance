import {COLOR, FORMAT_NAMES} from "../Utils/Constants.js";
import {Database} from "../Database.js";
import {GetGuild} from "../CRUD/Guilds.js";
import {GetChannel} from "../CRUD/Channels.js";
import {SelectMenuHandler} from "../Typings/HandlerTypes.js";
import {SimpleMessageExport} from "../Typings/DatabaseTypes.js";

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
		const exportID = interaction.values[0];
		const exportData = await Database.query(`SELECT * FROM Exports WHERE id = ?`, [exportID]).then(x => x[0]) as SimpleMessageExport | undefined;
		if (!exportData) {
			return { embeds: [NoExportEmbed], components: [] }
		}

		const guild_name   = (await GetGuild(exportData.guild_id))?.name     || 'Unknown Guild';
		const channel_name = (await GetChannel(exportData.channel_id))?.name || 'Unknown Channel';

		const embed = {
			color: COLOR.PRIMARY,
			description: `
**Export ID:** ${exportData.id}

**Guild** : ${guild_name} (${exportData.guild_id})
**Channel** : #${channel_name} (${exportData.channel_id})

**Messages** : ${exportData.message_count}
**Format** : ${FORMAT_NAMES[exportData.format] || 'Unknown'}

**Created At** : <t:${Math.floor(exportData.created_at)}:f>`
		}

		return { embeds: [embed], components: [] }
	}
} satisfies SelectMenuHandler as SelectMenuHandler;