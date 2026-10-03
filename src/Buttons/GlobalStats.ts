import {ButtonHandler} from "../Typings/HandlerTypes.js";
import {COLOR, SECONDS} from "../Utils/Constants.js";
import {Database} from "../Database.js";
import {APIEmbed} from "discord-api-types/v10";
import { Asset, SimpleMessage } from "../Typings/DatabaseTypes.js";

const STAT_SIZE = 10_000;

function FileSize(bytes: number): string {
	if (bytes < 1024) return `${bytes} byte(s)`;

	const units = ['KB', 'MB', 'GB'];
	let size = bytes / 1024;
	let unitIndex = 0;

	while (size >= 1024 && unitIndex < units.length - 1) {
		size /= 1024;
		unitIndex++;
	}

	return `${size.toFixed(2)} ${units[unitIndex]}`;
}

/** `a / b`, or 0 when there is nothing to divide by - an empty sample renders 0, not NaN or Infinity */
function Ratio(a: number, b: number): number {
	return b === 0 ? 0 : a / b;
}

const NO_DATA: APIEmbed = {
	color: COLOR.PRIMARY,
	title: '📊 Stats for nerds',
	description: 'No messages have been saved yet, check back later!'
}

let lastOutput: APIEmbed | null = null;
let lastRun = 0;
async function CalculateMessageStats(): Promise<APIEmbed> {
	// only compute every 30 minutes
	if (lastOutput && Date.now() - lastRun < SECONDS.MINUTE * 1000 * 30) {
		return lastOutput;
	}

	const selectedMessages = await Database.query(`
		SELECT *
		FROM Messages
		ORDER BY id DESC
		LIMIT ${STAT_SIZE}
	`) as SimpleMessage[];

	// Not cached, so the real stats show up as soon as there is something to count
	if (selectedMessages.length === 0) return NO_DATA;

	// The table can hold fewer than STAT_SIZE, every figure below is out of what was actually read
	const messageCount = selectedMessages.length;

	// messages are returned in reverse chronological order
	const endDate = selectedMessages[0].created_at;
	const startDate = selectedMessages[ selectedMessages.length - 1 ].created_at;

	const guildIDs = new Set<SimpleMessage['guild_id']>();
	const channelIDs = new Set<SimpleMessage['channel_id']>();
	const userIDs = new Set<SimpleMessage['user_id']>();
	let stickerMessages = 0;

	for (const message of selectedMessages) {
		guildIDs.add(message.guild_id);
		channelIDs.add(message.channel_id);
		userIDs.add(message.user_id);
		if (message.sticker_id) stickerMessages++;
	}

	const avgLength = selectedMessages.reduce((acc, msg) => acc + (msg.length ?? 0), 0) / messageCount;

	const messagesWithDiscordEmojis = selectedMessages.filter(msg => msg.data.emoji_ids.length > 0);
	const totalEmojis = messagesWithDiscordEmojis.reduce((acc, msg) => acc + msg.data.emoji_ids.length, 0);
	const avgEmojis = Ratio(totalEmojis, messagesWithDiscordEmojis.length);
	const maxEmojis = messagesWithDiscordEmojis.reduce((max, msg) => Math.max(max, msg.data.emoji_ids.length), 0);

	const messagesWithAttachments = selectedMessages.filter(msg => msg.data.attachments.length > 0);
	const attachmentIDs = messagesWithAttachments.flatMap(msg => msg.data.attachments.map(x => x.id));
	// `IN ()` is a syntax error, and a message can hold several attachments - one placeholder per ID
	const attachmentAssets = attachmentIDs.length === 0 ? [] : await Database.query(`
		SELECT * FROM Assets WHERE discord_id IN (${new Array(attachmentIDs.length).fill('?').join(',')})
	`, attachmentIDs) as Asset[];

	const totalFiles = attachmentIDs.length;
	const maxFileSize = attachmentAssets.reduce( (max, asset) => Math.max(max, asset.size), 0);
	const minFileSize = attachmentAssets.length === 0 ? 0 : attachmentAssets.reduce( (min, asset) => Math.min(min, asset.size), Infinity);

	const timeDiff = Math.abs(endDate.getTime() - startDate.getTime());
	const rate = Ratio(messageCount, timeDiff / 1000 / 60); // messages per minute
	const messagesPerUser = Ratio(messageCount, userIDs.size).toFixed(2);

	const output: APIEmbed = {
		color: COLOR.PRIMARY,
		title: '📊 Stats for nerds',
		description: `\`\`\`
Last ${messageCount} messages
- Guilds: ${guildIDs.size}
- Channels: ${channelIDs.size}
- Users: ${userIDs.size} (${messagesPerUser} msg/user)

- Avg Length: ${Math.round(avgLength)} characters

Emoji Stats (${totalEmojis} emojis) *
- Max emojis: ${maxEmojis} emojis
- Avg emojis: ${avgEmojis.toFixed(2)} emojis/msg

Files Stats (${totalFiles} files) **
- Max size: ${ FileSize(maxFileSize) }
- Min size: ${ FileSize(minFileSize) }
- Avg files: ${Ratio(totalFiles, messagesWithAttachments.length).toFixed(2)} files/msg
\`\`\`

**Quick Facts** \`\`\`
Only ${(stickerMessages / messageCount * 100).toFixed(2)}% of messages have a sticker
Only ${(messagesWithAttachments.length / messageCount * 100).toFixed(2)}% of messages have a file
The average user sent ${messagesPerUser} messages
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
		const stats = await CalculateMessageStats();
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