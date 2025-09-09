const GetExportCache = require("../../Utils/Caching/GetExportCache");
const { COLOR, RandomLoadingEmbed } = require("../../Utils/Constants");
const Export = require("../../Utils/Parsers/Export");
const { DownloadAssets } = require("../../Utils/Processing/Images");
const LinkAssets = require("../../Utils/Processing/LinkAssets");
const Crypto = require("crypto");

const UploadFiles = require("../../Utils/Tasks/UploadFiles");
const UploadCDN = require("../../Utils/UploadCDN");
const Database = require("../../Utils/Database");

const Log = require("../../Utils/Logs");

const loadingMessages = [
	'Hmm this is taking a while...',
	'Please wait a moment...',
	'Almost there...',
	'Just a little bit longer...'
]

const converstionMessages = [
	'Read any good books lately?',
	'So how\'s the weather?',
	'If I had legs I\'d be pacing right now',
	'This is a big one huh? Lots of messages?',
]

const stallingMessages = [
	'I hope this isn\'t the part that I crash...',
	'Okay so funny story - nevermind. Still exporting.',
	'Uh ... you still there?',
	'At this point I\'m just talking to myself',
]


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
		await DownloadAssets(); // download files
		await UploadFiles(); // upload files to the CDN
		await LinkAssets(); // link tables together

		let loadingInterval;
		let finished = false;

		// Start timeout after 10 seconds
		const loadingTimeout = setTimeout(() => {
			if (finished) return;

			let index = 0;
			loadingInterval = setInterval(() => {
				// pick 2 random messages from each category before moving on
				let messages = [];
				if (index < 2) messages = loadingMessages;
				else if (index < 4) messages = converstionMessages;
				else messages = stallingMessages;

				const randomMessage = messages[Math.floor(Math.random() * messages.length)];
				interaction.editReply({
					embeds: [{ color: COLOR.PRIMARY, description: randomMessage }],
				});

				index++;
			}, 5000); // every 5 seconds
		}, 5000); // 5-second delay

		let file;
		try {
			file = await Export(exportOptions);
		} catch (e) {
			Log.error(e);
			interaction.editReply({
				embeds: [{
					color: COLOR.ERROR,
					title: 'Export Failed',
					description: `
An error occurred while generating your export :broken_heart:
The error has been reported automatically and a fix is being worked on`
				}],
			});
			return;
		} finally {
			// stop the loading interval
			finished = true;
			clearTimeout(loadingTimeout);
			clearInterval(loadingInterval);
		}

		await interaction.editReply({ embeds: [RandomLoadingEmbed()] });

		const [name, extension] = file.name.split('.');

		// upload to the cdn server for easy access
		const lookup = await UploadCDN(name, extension, file.data, 1); // 1 url = 1 download

		const hash = Crypto.createHash('sha1').update(file.data).digest('hex');

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

		interaction.editReply({
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

		// clear the export cache
		client.ttlcache.delete(`export_${exportOptions.guildID}_${exportOptions.channelID}_${exportOptions.userID}`);
	}
}