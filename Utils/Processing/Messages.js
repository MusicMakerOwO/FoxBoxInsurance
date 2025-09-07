const CachePool = require('../Caching/CachePool');
const Database = require('../Database');
const sampleCache = new CachePool(3);

const { DownloadQueue, ASSET_TYPE } = require('./Images');

const Log = require('../Logs');
const LinkAssets = require('./LinkAssets');

module.exports = async function ProcessMessages (messageCache = sampleCache) {
	const messages = messageCache.cache[ messageCache.currentPool ];
	if (messages.length === 0) return;

	messageCache.switch();
	// clear new pool
	messageCache.clear();

	const connection = await Database.getConnection();

	let [{ id: currentEmbedID }] = await connection.query(`SELECT IFNULL(MAX(id), 0) + 1 AS id FROM Embeds`);

	Log.debug(`Processing ${messages.length} messages`);

	// 1. Deduplication - Combine similar features such as guild, channel, user, etc

	const Guilds = new Map();
	const Channels = new Map();
	const Users = new Map();
	const Emojis = new Map();
	const Stickers = new Map();
	const Attachments = new Map();

	// embeds and fields handled separately
	const Embeds = new Map(); // number -> embed
	const Fields = new Map(); // embedID -> field[]

	const MessageEmojiCounts = new Map(); // messageID -> emojiID -> count

	const start = process.hrtime.bigint();

	for (let i = messages.length - 1; i >= 0; i--) {
		const message = messages[i];
		const { guild, channel, user, emojis, sticker, attachments } = message;

		if (!Guilds.has(guild.id)	 ) Guilds.set(guild.id, guild);
		if (!Channels.has(channel.id)) Channels.set(channel.id, channel);
		if (!Users.has(user.id)		 ) Users.set(user.id, user);

		if (sticker && !Stickers.has(sticker.id)) Stickers.set(sticker.id, sticker);

		if (message.emojis.length > 0) {
			const emojiCounts = Object.fromEntries(message.emojis.map(e => [e.id, 0]));
			for (let i = 0; i < emojis.length; i++) {
				const emoji = emojis[i];
				if (!Emojis.has(emoji.id)) Emojis.set(emoji.id, emoji);
				emojiCounts[emoji.id]++;
			}
			MessageEmojiCounts.set(message.id, emojiCounts);
		}
		for (let i = 0; i < attachments.length; i++) {
			const attachment = attachments[i];
			if (!Attachments.has(attachment.id)) Attachments.set(attachment.id, attachment);
		}
		for (let i = 0; i < message.embeds.length; i++) {
			const embed = message.embeds[i];
			const embedID = currentEmbedID++;
			Embeds.set(embedID, embed);
			Fields.set(embedID, embed.fields);
		}
	}

	const GuildList 	 = Array.from( Guilds.values()		);
	const ChannelList 	 = Array.from( Channels.values()	);
	const UserList 		 = Array.from( Users.values()		);
	const EmojiList 	 = Array.from( Emojis.values()		);
	const StickerList 	 = Array.from( Stickers.values()	);
	const AttachmentList = Array.from( Attachments.values()	);
	const EmbedList 	 = [];
	const FieldList 	 = [];
	const MessageEmojis  = [];

	for (const [embedID, embed] of Embeds) {
		EmbedList.push({ ...embed, id: embedID });
	}

	for (const [embedID, fields] of Fields) {
		// This will still preserve the order of the fields
		// When exporting from the database make sure to use `ORDER BY id ASC`
		for (let i = 0; i < fields.length; i++) {
			const field = fields[i];
			FieldList.push({ embedID: embedID, ...field });
		}
	}

	for (const [messageID, emojiCounts] of MessageEmojiCounts.entries()) { // map
		for (const [emojiID, count] of Object.entries(emojiCounts)) { // object
			MessageEmojis.push({ messageID: messageID, emojiID: emojiID, count: count });
		}
	}

	const dedupeTime = process.hrtime.bigint();

	// 2. Insert deduplicated data into database

	await connection.beginTransaction();

	try {

		await connection.batch(`
			INSERT INTO Guilds (id, name)
			VALUES (?, ?)
			ON DUPLICATE KEY UPDATE name = VALUES(name)
		`, GuildList.map(g => [g.id, g.name]));

		await connection.batch(`
			INSERT INTO Channels (id, guild_id, name, type)
			VALUES (?, ?, ?, ?)
			ON DUPLICATE KEY UPDATE name = VALUES(name)
		`, ChannelList.map(c => [c.id, c.guildID, c.name, c.type]));

		await connection.batch(`
			INSERT INTO Users (id, username, bot)
			VALUES (?, ?, ?)
			ON DUPLICATE KEY UPDATE username = VALUES(username)
		`, UserList.map(u => [u.id, u.username, +u.bot]));

		if (EmojiList.length > 0) await connection.batch(`
			INSERT INTO Emojis (id, name, animated)
			VALUES (?, ?, ?)
			ON DUPLICATE KEY UPDATE name = VALUES(name)
		`, EmojiList.map(e => [e.id, e.name, +e.animated]));

		if (StickerList.length > 0) await connection.batch(`
			INSERT INTO Stickers (id, name)
			VALUES (?, ?)
			ON DUPLICATE KEY UPDATE name = VALUES(name)
		`, StickerList.map(s => [s.id, s.name]));

		await connection.batch(`
			INSERT INTO Messages (id, guild_id, channel_id, user_id, content, sticker_id, reply_to, length)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?)
		`, messages.map(m => [m.id, m.guild.id, m.channel.id, m.user.id, m.content, m.sticker?.id, m.reply_to, m.content?.length]));

		if (MessageEmojis.length > 0) await connection.batch(`
			INSERT INTO MessageEmojis (message_id, emoji_id, count)
			VALUES (?, ?, ?)
		`, MessageEmojis.map(m => [m.messageID, m.emojiID, m.count]));

		if (AttachmentList.length > 0) await connection.batch(`
			INSERT INTO Attachments (id, message_id, name)
			VALUES (?, ?, ?)
			ON DUPLICATE KEY UPDATE name = VALUES(name)
		`, AttachmentList.map(a => [a.id, a.messageID, a.name]));

		if (EmbedList.length > 0) await connection.batch(`
			INSERT INTO Embeds (
				id, message_id,
				title, description, url, timestamp, color,
				footer_text, footer_icon,
				thumbnail_url, image_url,
				author_name, author_url, author_icon
			)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`, EmbedList.map(e => [
			e.id, e.messageID,
			e.title, e.description, e.url, e.timestamp, e.color,
			e.footer_text, e.footer_icon,
			e.thumbnail_url, e.image_url,
			e.author_name, e.author_url, e.author_icon
		]));

		if (FieldList.length > 0) await connection.batch(`
			INSERT INTO EmbedFields (embed_id, name, value, inline)
			VALUES (?, ?, ?, ?)
		`, FieldList.map(f => [f.embedID, f.name, f.value, +f.inline]));

		await connection.commit();
	} catch (error) {
		await connection.rollback();
		Database.releaseConnection(connection);
		Log.error(error);
		return; // do not print timing logs
	}

	Database.releaseConnection(connection);

	const databaseTime = process.hrtime.bigint();

	// Timing logs for debugging
	const dedupeTimeMs = Number(dedupeTime - start) / 1e6;
	const dedupeEffeciency = (messages.length / dedupeTimeMs) * 1000

	const databaseTimeMs = Number(databaseTime - dedupeTime) / 1e6;
	const databaseEffeciency = (messages.length / databaseTimeMs) * 1000;

	Log.debug(`Deduplication took ${dedupeTimeMs.toFixed(3)}ms (${dedupeEffeciency.toFixed(3)}msg/sec)`);
	Log.debug(`Database insertion took ${databaseTimeMs}ms (${databaseEffeciency.toFixed(3)}msg/sec)`);

	// 3. Queue assets for download
	for (const emoji of EmojiList) {
		DownloadQueue.push({
			type: ASSET_TYPE.EMOJI,
			id: emoji.id,
			name: emoji.name,
			url: emoji.url,
			width: emoji.width,
			height: emoji.height
		});
	}

	for (const sticker of StickerList) {
		DownloadQueue.push({
			type: ASSET_TYPE.STICKER,
			id: sticker.id,
			name: sticker.name,
			url: sticker.url,
			width: sticker.width,
			height: sticker.height
		});
	}

	for (const guild of GuildList) {
		if (!guild.icon) continue;
		DownloadQueue.push({
			type: ASSET_TYPE.GUILD,
			id: guild.id,
			name: guild.name,
			url: guild.icon.url,
			width: guild.icon.width,
			height: guild.icon.height
		});
	}

	for (const user of UserList) {
		if (!user.icon) continue;
		DownloadQueue.push({
			type: ASSET_TYPE.USER,
			id: user.id,
			name: user.username,
			url: user.icon.url,
			width: user.icon.width,
			height: user.icon.height
		});
	}

	// 4. Link assets downloaded previously (not the ones in here)
	LinkAssets();
}