const GetExportCache = require("../../Utils/Caching/GetExportCache");
const { COLOR, RandomLoadingEmbed } = require("../../Utils/Constants");
const Export = require("../../Utils/Parsers/Export");
const { DownloadAssets } = require("../../Utils/Processing/Images");
const LinkAssets = require("../../Utils/Processing/LinkAssets");
const Crypto = require("crypto");

const ProcessMessages = require("../../Utils/Processing/Messages");
const UploadFiles = require("../../Utils/Tasks/UploadFiles");
const UploadCDN = require("../../Utils/UploadCDN");
const Database = require("../../Utils/Database");
const { type } = require("os");

module.exports = {
	customID: 'export-finish',
	execute: async function(interaction, client, args) {
		const exportOptions = await GetExportCache(client, interaction);
		if (!exportOptions) return;
		
		// this could take a while...
		await interaction.deferUpdate().catch(() => {});
		await interaction.editReply({ embeds: [RandomLoadingEmbed()], components: [] });

		// flush all the caches first to make sure we have the latest data
		// We don't want any missing assets or holes in the data
		ProcessMessages(client.messageCache); // save messages
		await DownloadAssets(); // download files
		await UploadFiles(); // upload files to the CDN
		LinkAssets(); // link tables together

		const file = await Export(exportOptions); // { name: string, data: Buffer }

		await interaction.editReply({ embeds: [RandomLoadingEmbed()] });
		
		const [name, extension] = file.name.split('.');
		
		// upload to the cdn server for easy access
		const lookup = await UploadCDN(name, extension, file.data, 1); // 1 url = 1 download

		const hash = Crypto.createHash('sha1').update(file.data).digest('hex');

		// insert the export into the database
		Database.prepare(`
			INSERT INTO Exports (id, guild_id, channel_id, user_id, message_count, format, hash, lookup)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?)
		`).run(
			file.id,
			exportOptions.guildID,
			exportOptions.channelID,
			exportOptions.userID,
			exportOptions.messageCount,
			exportOptions.format,
			hash,
			lookup
		);

		const downloadButton = {
			type: 1,
			components: [{
				type: 2,
				style: 5,
				label: 'Download',
				url: `https://cdn.notfbi.dev/download/${lookup}`,
				emoji: '📥',
			}]
		}

		await interaction.editReply({
			components: [downloadButton],
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
		});
	}
}