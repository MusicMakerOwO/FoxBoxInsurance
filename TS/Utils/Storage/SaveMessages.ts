import { Statement } from "better-sqlite3";
import { BasicMessage, Guild, Channel, User, EmojiAsset, AttachmentAsset, StickerAsset, BasicEmbed } from "../../typings";
import Database from '../Database';
import Log from '../Logs';

// Assets will be downloaded at a later time in a separate part of the code
// For now save to a cache with the asset, cache location, and ID
const QUERY_InsertGuild = Database.prepare(`
	INSERT INTO Guilds (id, name)
	VALUES (?, ?)
	ON CONFLICT(id) DO UPDATE SET
		name = excluded.name
`);

const QUERY_InsertChannel = Database.prepare(`
	INSERT INTO Channels (id, guild_id, name, parent_id, type)
	VALUES (?, ?, ?, ?, ?)
	ON CONFLICT(id) DO UPDATE SET
		name = excluded.name,
		parent_id = excluded.parent_id
`);

const QUERY_InsertUser = Database.prepare(`
	INSERT INTO Users (id, username, bot)
	VALUES (?, ?, ?)
	ON CONFLICT(id) DO UPDATE SET
		username = excluded.username
`);

const QUERY_InsertEmoji = Database.prepare(`
	INSERT INTO Emojis (id, name, animated)
	VALUES (?, ?, ?)
	ON CONFLICT(id) DO UPDATE SET
		name = excluded.name
`);

const QUERY_InsertSticker = Database.prepare(`
	INSERT INTO Stickers (id, name)
	VALUES (?, ?)
	ON CONFLICT(id) DO UPDATE SET
		name = excluded.name
`);

const QUERY_InsertMessage = Database.prepare(`
	INSERT INTO Messages (id, guild_id, channel_id, user_id, content, sticker_id)
	VALUES (?, ?, ?, ?, ?, ?)
	ON CONFLICT(id) DO NOTHING
`);

const QUERY_InsertEmbed = Database.prepare(`
	INSERT INTO Embeds (id, message_id, title, description, url, timestamp, color, footer_text, footer_icon, thumbnail_url, image_url, author_name, author_url, author_icon)
	VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const QUERY_InsertEmbedField = Database.prepare(`
	INSERT INTO EmbedFields (embed_id, name, value, inline)
	VALUES (?, ?, ?, ?)
`);

const QUERY_InsertMember = Database.prepare(`
	INSERT INTO Members (guild_id, user_id, joined_at)
	VALUES (?, ?, ?)
	ON CONFLICT(guild_id, user_id) DO NOTHING
`);

const QUERY_InsertAttachment = Database.prepare(`
	INSERT INTO Attachments (id, name, message_id)
	VALUES (?, ?, ?)
	ON CONFLICT(id) DO NOTHING
`);

const QUERY_InsertMessageEmoji = Database.prepare(`
	INSERT INTO MessageEmojis (message_id, emoji_id)
	VALUES (?, ?)
	ON CONFLICT(message_id, emoji_id) DO NOTHING
`);


const LINKED_TABLES = [
	'Guilds',
	'Users',
	'Emojis',
	'Stickers',
	'Attachments'
];

const ASSET_LINKS : Statement[] = [];

for (let i = 0; i < LINKED_TABLES.length; i++) {
	const table = LINKED_TABLES[i];
	if (!Database.tables.includes(table)) throw new Error(`Unknown table: ${table}`);
	ASSET_LINKS.push( Database.prepare(`UPDATE ${table} SET asset_id = (SELECT asset_id FROM Assets WHERE ${table}.id = Assets.id) WHERE asset_id IS NULL`) );
}

export default function (messages: BasicMessage[]) {
	// Combine like terms first to reduce database load
	// We will work backwards so we always get the latest data
	// This all adds some extra runtime and making this O(2n) but it saves a lot of time over all

	if (messages.length === 0) return;

	Log.info(`Saving ${messages.length} messages to the database...`);

	const start = process.hrtime.bigint();

	const guilds: Record<string, Guild> = {};
	const channels: Record<string, Channel> = {};
	const users: Record<string, User> = {};

	const emojis: Record<string, EmojiAsset> = {};
	const attachments: Record<string, AttachmentAsset> = {};
	const stickers: Record<string, StickerAsset> = {};

	const embeds: Record<string, BasicEmbed> = {};

	const messageEmojis = new Set<string>(); // messageID-emojiID

	const members: Record<string, string> = {}; // guildID-userID : joinedAt

	for (let i = messages.length - 1; i >= 0; i--) {
		const message = messages[i];

		guilds[message.guild.id] ||= message.guild;
		channels[message.channel.id] ||= message.channel;
		users[message.user.id] ||= message.user;

		members[`${message.guild.id}-${message.user.id}`] ||= message.user.joinedAt;

		for (let i = 0; i < message.emojis.length; i++) {
			emojis[message.emojis[i].id] ||= message.emojis[i];
			messageEmojis.add(`${message.id}-${message.emojis[i].id}`);
		}

		for (let i = 0; i < message.attachments.length; i++) {
			attachments[message.attachments[i].id] ||= message.attachments[i];
		}

		if (message.sticker) {
			stickers[message.sticker.id] ||= message.sticker;
		}

		for (let i = 0; i < message.embeds.length; i++) {
			const embed = message.embeds[i];
			embeds[embed.id] ||= embed;
		}
	}

	// Now that we can ensure that every entry is unique we can upload them in bulk
	// This too adds some overhead, working with arrays is both simpler and faster
	// Benchmarks show that standard for loops are faster than for...of and for...in
	// I'm not super stingy for performance but considering I am dealing with hundreds of thousands of messages speed matters here

	const guildList = Array.from(Object.values(guilds));
	const channelList = Array.from(Object.values(channels));
	const userList = Array.from(Object.values(users));
	const emojiList = Array.from(Object.values(emojis));
	const attachmentList = Array.from(Object.values(attachments));
	const stickerList = Array.from(Object.values(stickers));
	const embedList = Array.from(Object.values(embeds));
	const messageEmojiList = Array.from(messageEmojis);

	// Map<guildID-userID, joinedAt> -> Array<{guildID, userID, joinedAt}>
	const memberList = Object.entries(members).map(([key, value]) => {
		const [guildID, userID] = key.split('-');
		return { guildID, userID, joinedAt: value };
	});
	

	// We will use a transaction to speed up the process and add some error handling

	Database.exec('BEGIN TRANSACTION');

	try {
		for (let i = 0; i < guildList.length; i++) {
			const guild = guildList[i];
			QUERY_InsertGuild.run(guild.id, guild.name);
		}

		for (let i = 0; i < channelList.length; i++) {
			const channel = channelList[i];
			QUERY_InsertChannel.run(channel.id, channel.guildID, channel.name, channel.parentID, channel.type);
		}

		for (let i = 0; i < userList.length; i++) {
			const user = userList[i];
			QUERY_InsertUser.run(user.id, user.username, +user.bot);
		}

		for (let i = 0; i < memberList.length; i++) {
			const member = memberList[i];
			QUERY_InsertMember.run(member.guildID, member.userID, member.joinedAt);
		}

		for (let i = 0; i < messages.length; i++) {
			const message = messages[i];
			QUERY_InsertMessage.run(message.id, message.guild.id, message.channel.id, message.user.id, message.content, message.sticker?.id || null);
		}

		for (let i = 0; i < emojiList.length; i++) {
			const emoji = emojiList[i];
			QUERY_InsertEmoji.run(emoji.id, emoji.name, +emoji.animated);
		}

		for (let i = 0; i < attachmentList.length; i++) {
			const attachment = attachmentList[i];
			QUERY_InsertAttachment.run(attachment.id, attachment.name, attachment.messageID);
		}

		for (let i = 0; i < stickerList.length; i++) {
			const sticker = stickerList[i];
			QUERY_InsertSticker.run(sticker.id, sticker.name);
		}

		for (let i = 0; i < embedList.length; i++) {
			const embed = embedList[i];
			QUERY_InsertEmbed.run(
				embed.id,
				embed.messageID,
				embed.title,
				embed.description,
				embed.url,
				embed.timestamp,
				embed.color,
				embed.footer_text,
				embed.footer_icon,
				embed.thumbnail_url,
				embed.image_url,
				embed.author_name,
				embed.author_url,
				embed.author_icon
			);

			for (let i = 0; i < embed.fields.length; i++) {
				const field = embed.fields[i];
				QUERY_InsertEmbedField.run(embed.id, field.name, field.value, +!!field.inline);
			}
		}

		for (let i = 0; i < messageEmojiList.length; i++) {
			const [messageID, emojiID] = messageEmojiList[i].split('-');
			QUERY_InsertMessageEmoji.run(messageID, emojiID);
		}

		Database.exec('COMMIT');
	} catch (error) {
		Database.exec('ROLLBACK');
		console.error('Failed to save messages to the database:', error);
	}

	for (let i = 0; i < ASSET_LINKS.length; i++) {
		ASSET_LINKS[i].run();
	}

	const end = process.hrtime.bigint();
	Log.success(`Saved ${messages.length} messages to the database in ${(Number(end - start) / 1e6).toFixed(2)}ms`);
}