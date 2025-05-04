const { SECONDS, COLOR } = require("../Utils/Constants");
const Database = require("../Utils/Database");

const STAT_SIZE = 10_000;

const BackButton = {
	type: 1,
	components: [{
		type: 2,
		style: 4,
		label: 'Back',
		custom_id: 'bot-info',
	}]
}

function DiscordIDToDate(id = 0n) {
	return new Date(Number((id >> 22n) + 1420070400000n));
}

let lastOutput = {};
let lastRun = 0;
function CalcuateMessageStats() {
	// only compute every 30 minutes
	if (Date.now() - lastRun < SECONDS.MINUTE * 1000 * 30) {
		return lastOutput;
	}

	const MessageStats = Database.prepare(`
		WITH selected_messages AS (
			SELECT id, user_id, guild_id, channel_id, content, sticker_id, length
			FROM Messages
			ORDER BY id DESC
			LIMIT ${STAT_SIZE}
		)
		SELECT
			COUNT(*) AS message_count,
			COUNT(DISTINCT user_id) AS user_count,
			COUNT(DISTINCT guild_id) AS guild_count,
			COUNT(DISTINCT channel_id) AS channel_count,
			COUNT(DISTINCT sticker_id) AS sticker_count,

			ROUND(AVG(length), 2) AS avg_length
		FROM selected_messages
	`).get();

	const FileStats = Database.prepare(`
		WITH selected_files AS (
			SELECT Messages.id as message_id, Assets.size as size, Assets.asset_id as file_id
			FROM Messages
			LEFT OUTER JOIN Attachments ON Messages.id = Attachments.message_id
			LEFT OUTER JOIN Assets ON Attachments.asset_id = Assets.asset_id
			ORDER BY Messages.id DESC
			LIMIT ${STAT_SIZE}
		)
		SELECT
			COUNT(DISTINCT message_id) as message_count,
			COUNT(DISTINCT file_id) as file_count,
			MAX(size) as max_file,
			MIN(size) as min_file
		FROM selected_files
		WHERE size IS NOT NULL
	`).get();

	const EmojiStats = Database.prepare(`
		WITH selected_emojis AS (
			SELECT
				Messages.id as message_id,
				user_id,
				Emojis.id as emoji_id
			FROM Messages
			LEFT OUTER JOIN MessageEmojis ON MessageEmojis.message_id = Messages.id
			LEFT OUTER JOIN Emojis ON MessageEmojis.emoji_id = Emojis.id
			ORDER BY Messages.id DESC
			LIMIT ${STAT_SIZE}
		)
		SELECT
			COUNT(emoji_id) as emojis,
			COUNT(DISTINCT message_id) as messages
		FROM selected_emojis
		WHERE emoji_id IS NOT NULL
	`).get();

	const topEmoji = Database.prepare(`
		WITH selected_emojis AS (
			SELECT
				Messages.id AS message_id,
				Messages.user_id,
				Emojis.id AS emoji_id
			FROM Messages
			LEFT JOIN MessageEmojis ON MessageEmojis.message_id = Messages.id
			LEFT JOIN Emojis ON MessageEmojis.emoji_id = Emojis.id
			WHERE Emojis.id IS NOT NULL
			ORDER BY Messages.id DESC
			LIMIT ${STAT_SIZE}
		),
		emoji_counts AS (
			SELECT
				message_id,
				user_id,
				COUNT(emoji_id) AS emoji_count
			FROM selected_emojis
			GROUP BY message_id
		)
		SELECT MAX(emoji_count) AS 'max'
		FROM emoji_counts
		WHERE emoji_count IS NOT NULL
	`).get();

	const timespan = Database.prepare(`
		WITH selected_messages AS (
			SELECT id, length
			FROM Messages
			ORDER BY id DESC
			LIMIT ${~~(STAT_SIZE / 10)} -- 1/10 of the messages
		)
		SELECT
			MAX(id) as max_id,
			MIN(id) as min_id,
			COUNT(*) as "count"
		FROM selected_messages
	`).get();

	const maxDate = DiscordIDToDate(BigInt(timespan.max_id));
	const minDate = DiscordIDToDate(BigInt(timespan.min_id));
	const timeDiff = Math.abs(maxDate - minDate);
	const rate = timespan.count / (timeDiff / 1000 / 60); // messages per minute

	const output = {
		color: COLOR.PRIMARY,
		title: '📊 Stats for nerds',
		description: `\`\`\`
Last ${MessageStats.message_count} messages
- Guilds: ${MessageStats.guild_count}
- Channels: ${MessageStats.channel_count}
- Users: ${MessageStats.user_count} (${(MessageStats.message_count / MessageStats.user_count).toFixed(2)} msg/user)

- Avg Length: ${MessageStats.avg_length} characters

Emoji Stats (${EmojiStats.emojis} emojis) *
- Max emojis: ${topEmoji.max} emojis
- Avg emojis: ${(EmojiStats.emojis / EmojiStats.messages).toFixed(2)} emojis/msg

Files Stats (${FileStats.file_count} files) **
- Max size: ${(FileStats.max_file / 1024 / 1024).toFixed(2)} MB
- Min size: ${(FileStats.min_file / 1024).toFixed(2)} KB
- Avg files: ${(FileStats.file_count / FileStats.message_count).toFixed(2)} files/msg
\`\`\`

**Quick Facts** \`\`\`
Only ${(MessageStats.sticker_count / MessageStats.message_count * 100).toFixed(2)}% of messages have a sticker
Only ${(FileStats.message_count / MessageStats.message_count * 100).toFixed(2)}% of messages have a file
The average user sent ${(MessageStats.message_count / MessageStats.user_count).toFixed(2)} messages
On average, ${rate.toFixed(2)} messages are sent per minute
\`\`\`
-# \\* Only messages with emojis are counted
-# \\*\\* Only messages with files are counted

Last updated <t:${Math.floor(Date.now() / 1000)}:R>
Next update <t:${Math.floor((Date.now() + SECONDS.MINUTE * 1000 * 30) / 1000)}:R>`
	}

	lastOutput = output;
	lastRun = Date.now();

	return output;
}

module.exports = {
	customID: 'global-stats',
	execute: async function(interaction, client, args) {
		if (!interaction.deferred) await interaction.deferUpdate().catch(() => {});

		const start = process.hrtime.bigint();
		const stats = CalcuateMessageStats();
		const end = process.hrtime.bigint();
		const elapsed = Number(end - start) / 1e6;

		console.log(`Stats calculated in ${elapsed.toFixed(3)}ms`);
		await interaction.editReply({ embeds: [stats], components: [BackButton] }).catch(() => {});
	}
}