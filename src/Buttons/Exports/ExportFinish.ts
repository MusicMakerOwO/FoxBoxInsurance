import { GetExportCache, SESSION_EXPIRED_RESPONSE } from "../../Utils/Caching/GetExportCache.js";
import {COLOR} from "../../Utils/Constants.js";
import {DownloadAssets} from "../../Utils/Processing/Images.js";
import {ButtonHandler} from "../../Typings/HandlerTypes.js";
import {UploadCDN} from "../../Utils/UploadCDN.js";
import {Log} from "../../Utils/Log.js";
import {Database} from "../../Database.js";
import {ExportChannel} from "../../Utils/Parsers/Export.js";
import {UploadFiles} from "../../Utils/Tasks/UploadFiles.js";
import { TOS_FEATURES } from "../../TOSConstants.js";
import { GUILD_FEATURES } from "../../Typings/DatabaseTypes.js";

export default {
	tos_features  : [ TOS_FEATURES.MESSAGE_EXPORTS ],
	guild_features: [ GUILD_FEATURES.EXPORT_MESSAGES ],
	permissions   : [],
	response_type : 'update',
	hidden        : false,
	customID      : 'export-finish',
	execute       : async function(interaction, client) {
		const exportOptions = GetExportCache(client, interaction);
		if (!exportOptions) return SESSION_EXPIRED_RESPONSE;

		// Export is disabled at 0 messages, but a stale or replayed click can still get here. Nothing
		// went wrong, so this isn't an Export Failed report, and the menu stays as it was.
		if (exportOptions.messageCount < 1) {
			return {
				followUp: {
					embeds: [{
						color: COLOR.ERROR,
						description: 'There are no messages to export - Pick a channel with saved messages first'
					}]
				}
			};
		}

		// flush all the caches first to make sure we have the latest data
		// We don't want any missing assets or holes in the data
		await DownloadAssets(); // download files
		await UploadFiles(); // upload files to the CDN

		let file: Awaited<ReturnType<typeof ExportChannel>>;
		let lookup: string;
		try {
			file = await ExportChannel(exportOptions);

			// upload to the cdn server for easy access
			lookup = await UploadCDN(file.name, file.data, 1); // 1 url = 1 download

			// insert the export into the database
			await Database.query(`
				INSERT INTO Exports (id, guild_id, channel_id, user_id, message_count, format, hash_algorithm, hash, lookup)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
			`, [
				file.id,
				exportOptions.guildID,
				exportOptions.channelID,
				exportOptions.userID,
				exportOptions.messageCount,
				exportOptions.format,
				file.hash[0],
				file.hash[1],
				lookup
			]);
		} catch (error) {
			Log('ERROR', error);
			return {
				embeds: [{
					color: COLOR.ERROR,
					title: 'Export Failed',
					description: `
An error occurred while generating your export 💔
The error has been reported automatically and a fix is being worked on`
				}],
				components: []
			}
		}

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