import {GetExportCache} from "../../Utils/Caching/GetExportCache";
import {COLOR} from "../../Utils/Constants";
import {DownloadAssets} from "../../Utils/Processing/Images";
import {ButtonHandler} from "../../Typings/HandlerTypes";
import {UploadCDN} from "../../Utils/UploadCDN";
import {createHash} from "node:crypto";
import {Log} from "../../Utils/Log";
import {Database} from "../../Database";
import {ExportChannel} from "../../Utils/Parsers/Export";
import { TOS_FEATURES } from "../../TOSConstants";
import { GUILD_FEATURES } from "../../Typings/DatabaseTypes";

export default {
	tos_features  : [ TOS_FEATURES.MESSAGE_EXPORTS ],
	guild_features: [ GUILD_FEATURES.EXPORT_MESSAGES ],
	permissions   : [],
	response_type : 'update',
	hidden        : false,
	customID      : 'export-finish',
	execute       : async function(interaction) {
		// @ts-expect-error
		const exportOptions = await GetExportCache(interaction);
		if (!exportOptions) return {};


		// flush all the caches first to make sure we have the latest data
		// We don't want any missing assets or holes in the data
		await DownloadAssets(); // download files
		// await UploadFiles(); // upload files to the CDN
		// await LinkAssets(); // link tables together

		let file;
		try {
			file = await ExportChannel(exportOptions);
		} catch (error) {
			Log('ERROR', error);
			return {
				embeds: [{
					color: COLOR.ERROR,
					title: 'Export Failed',
					description: `
An error occurred while generating your export :broken_heart:
The error has been reported automatically and a fix is being worked on`
				}],
			}
		}

		// upload to the cdn server for easy access
		const [name, extension] = file.name.split('.');
		const lookup = await UploadCDN(name, extension, file.data, 1); // 1 url = 1 download

		const hash = createHash('sha1').update(file.data).digest('hex');

		// insert the export into the database
		await Database.query(`
			INSERT INTO Exports (id, guild_id, channel_id, user_id, message_count, format, hash, lookup)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?)
		`, [
			file.id,
			exportOptions.guildID,
			exportOptions.channelID,
			exportOptions.userID,
			exportOptions.messageCount,
			exportOptions.format,
			hash,
			lookup
		]);

		return {
			components: [{
				type: 1,
				components: [{
					type: 2,
					style: 5,
					label: 'Download',
					url: `https://cdn.notfbi.dev/download/${lookup}`,
					emoji: { name: '📥' },
				}]
			}],
			embeds: [
				{
					color: COLOR.PRIMARY,
					description: `
Exported ${exportOptions.messageCount} messages from <#${exportOptions.channelID}>

**Download Link**: [Click here to download](https://cdn.notfbi.dev/download/${lookup})
**File Size**: ${(file.data.length / 1024).toFixed(2)} KB
**Export ID**: \`${file.id}\`

The download link will expire after 24 hours - You will not be given this link again!`
				}
			]
		}
	}
} satisfies ButtonHandler as ButtonHandler;