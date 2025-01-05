import { SlashCommandBuilder } from "discord.js";
import { CommandFile, MicroClient, MicroInteraction } from "../typings";
import Database from "../Utils/Database";

import ProgressBar from "../Utils/ProgressBar";

// These are just arbitrary numbers lol
// The cache can grow to virtually any size
const DOWNLOAD_MAX_SIZE = 100;
const MESSAGE_MAX_SIZE = 1000;

const QUERY_GetCounts = Database.prepare(`
	SELECT
		(SELECT COUNT(*) FROM messages) as message_count,
		(SELECT COUNT(*) FROM emojis) as emoji_count,
		(SELECT COUNT(*) FROM stickers) as sticker_count,
		(SELECT COUNT(*) FROM attachments) as attachment_count,

		(SELECT COUNT(*) FROM guilds) as guild_count,
		(SELECT COUNT(*) FROM channels) as channel_count,
		(SELECT COUNT(*) FROM users) as user_count
`);

export default {
	data: new SlashCommandBuilder()
		.setName('cache')
		.setDescription('Debug command to see cache storage'),
	async execute(interaction: MicroInteraction, client: MicroClient) {

		const DownloadCacheSize = client.downloadQueue.length;
		let MessageCacheSize = 0;
		for (let i = 0; i < client.messageCache.pools.length; i++) {
			console.log(`Pool ${i} :`, client.messageCache.pools[i]);
			MessageCacheSize += client.messageCache.pools[i].length;
		}

		console.log(DownloadCacheSize, MessageCacheSize);

		const downloadBar = ProgressBar(DownloadCacheSize, DOWNLOAD_MAX_SIZE);
		const messageBar = ProgressBar(MessageCacheSize, MESSAGE_MAX_SIZE);

		const counts = QUERY_GetCounts.get();

		const embed = {
			description: `
**Download Cache** : \`${downloadBar}\`
**Message Cache** : \`${messageBar}\`

**Stat Dump** \`\`\`
${JSON.stringify(counts, null, 2)}
\`\`\`
			`,
			color: 0xFF7900,
		}

		await interaction.reply({ embeds: [embed] });
	}
} as CommandFile;