import {ButtonHandler} from "../Typings/HandlerTypes";
import {COLOR, SECONDS} from "../Utils/Constants";
import {Database} from "../Database";
import {APIEmbed} from "discord-api-types/v10";
import { Asset, SimpleMessage } from "../Typings/DatabaseTypes";

const STAT_SIZE = 10_000;

function FileSize(bytes: number): string {
	if (bytes < 1024) return `${bytes} byte(s)`;

	const units = ['KB', 'MB', 'GB', 'TB', 'TB'];
	let size = bytes / 1024;
	let unitIndex = 0;

	while (size >= 1024 && unitIndex < units.length - 1) {
		size /= 1024;
		unitIndex++;
	}

	return `${size.toFixed(2)} ${units[unitIndex]}`;
}

let lastOutput = {};
let lastRun = 0;
async function CalcuateMessageStats(): Promise<APIEmbed> {
	// only compute every 30 minutes
	if (Date.now() - lastRun < SECONDS.MINUTE * 1000 * 30) {
		return lastOutput;
	}

	const connection = await Database.getConnection();

	const selectedMessages = await connection.query(`
		SELECT *
		FROM Messages
		ORDER BY id DESC
		LIMIT ${STAT_SIZE}
	`) as SimpleMessage[];

	// messages are returned in reverse chronological order
	const endDate = selectedMessages[0].created_at;
	const startDate = selectedMessages[ selectedMessages.length - 1 ].created_at;

	const guildIDs = new Set<SimpleMessage['guild_id']>();
	const channelIDs = new Set<SimpleMessage['channel_id']>();
	const userIDs = new Set<SimpleMessage['user_id']>();
	const stickerIDs = new Set<NonNullable<SimpleMessage['sticker_id']>>();

	for (const message of selectedMessages) {
		guildIDs.add(message.guild_id);
		channelIDs.add(message.channel_id);
		userIDs.add(message.user_id);
		if (message.sticker_id) stickerIDs.add(message.sticker_id);
	}

	const avgLength = selectedMessages.reduce((acc, msg) => acc + (msg.length ?? 0), 0) / selectedMessages.length;

	const messagesWithDiscordEmojis = selectedMessages.filter(msg => msg.data.emoji_ids.length > 0);
	const avgEmojis = messagesWithDiscordEmojis.reduce((acc, msg) => acc + msg.data.emoji_ids.length, 0) / messagesWithDiscordEmojis.length;
	const maxEmojis = messagesWithDiscordEmojis.reduce((max, msg) => Math.max(max, msg.data.emoji_ids.length), 0);

	const messagesWithAttachments = selectedMessages.filter(msg => msg.data.attachments.length > 0);
	const attachmentAssets = await connection.query(`
		SELECT * FROM Assets WHERE discord_id IN (${new Array(messagesWithAttachments.length).fill('?').join(',')})
	`, messagesWithAttachments.flatMap(msg => msg.data.attachments.map(x => x.id))) as Asset[];

	const totalFiles = messagesWithAttachments.reduce( (acc, msg) => acc + msg.data.attachments.length, 0);
	const maxFileSize = attachmentAssets.reduce( (max, asset) => Math.max(max, asset.size), 0);
	const minFileSize = attachmentAssets.reduce( (min, asset) => Math.min(min, asset.size), Infinity);

	Database.releaseConnection(connection);

	const timeDiff = Math.abs(endDate.getTime() - startDate.getTime());
	const rate = STAT_SIZE / (timeDiff / 1000 / 60); // messages per minute

	const output: APIEmbed = {
		color: COLOR.PRIMARY,
		title: '📊 Stats for nerds',
		description: `\`\`\`
Last ${STAT_SIZE} messages
- Guilds: ${guildIDs.size}
- Channels: ${channelIDs.size}
- Users: ${userIDs.size} (${(STAT_SIZE / userIDs.size).toFixed(2)} msg/user)

- Avg Length: ${Math.round(avgLength)} characters

Emoji Stats (${messagesWithDiscordEmojis.length} emojis) *
- Max emojis: ${maxEmojis} emojis
- Avg emojis: ${avgEmojis.toFixed(2)} emojis/msg

Files Stats (${totalFiles} files) **
- Max size: ${ FileSize(maxFileSize) }
- Min size: ${ FileSize(minFileSize) }
- Avg files: ${(totalFiles / messagesWithAttachments.length).toFixed(2)} files/msg
\`\`\`

**Quick Facts** \`\`\`
Only ${(stickerIDs.size / STAT_SIZE * 100).toFixed(2)}% of messages have a sticker
Only ${(messagesWithAttachments.length / STAT_SIZE * 100).toFixed(2)}% of messages have a file
The average user sent ${(STAT_SIZE / userIDs.size).toFixed(2)} messages
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

export default {
	tos_features  : [],
	guild_features: [],
	permissions   : [],
	response_type : 'update',
	hidden        : false,
	customID      : 'global-stats',
	execute       : async function() {
		console.time('Calculating stats');
		const stats = await CalcuateMessageStats();
		console.timeEnd('Calculating stats');

		return {
			embeds: [stats],
			components: [{
				type: 1,
				components: [{
					type: 2,
					style: 4,
					label: 'Back',
					custom_id: 'bot-info',
				}]
			}]
		}
	}
} satisfies ButtonHandler as ButtonHandler;