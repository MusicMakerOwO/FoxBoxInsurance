const { GetGuildTOS } = require('../Utils/Caching/TOS');
const SimplifyMessage = require('../Utils/Parsers/ParseMessage');
const { AddDownloadToQueue, ASSET_TYPE, DownloadAssets } = require('../Utils/Processing/Images');
const fs = require('node:fs');
const { FAILED_MESSAGES } = require("../Utils/Constants");
const Log = require('../Utils/Logs');
const Database = require('../Utils/Database');
const LRUCache = require('../Utils/Caching/LRUCache');

const MAX_CACHE_SIZE = 1000;
const FLUSH_INTERVAL = 30_000;

const GUILD_CACHE   = new LRUCache(2000); // max 2,000 guilds per shard
const CHANNEL_CACHE = new LRUCache(10_000); // the rest of these values I chose completely at random lol
const USER_CACHE    = new LRUCache(50_000);
const STICKER_CACHE = new LRUCache(5_000);
const EMOJI_CACHE   = new LRUCache(5_000);

const TABLE_COLUMNS = {
	// globals
	GUILDS       : ['id', 'name'],
	CHANNELS     : ['id', 'guild_id', 'name', 'type'],
	USERS        : ['id', 'username', 'bot'],

	// only certain messages
	STICKERS     : ['id', 'name'],
	EMOJIS       : ['id', 'name', 'animated'],
	EMOJI_COUNTS : ['message_id', 'emoji_id', 'count'], // message metadata

	MESSAGES     : ['id', 'guild_id', 'channel_id', 'user_id', 'content', 'reply_to', 'sticker_id'],

	// optional metadata for messages
	ATTACHMENTS  : ['id', 'message_id', 'name'],
	EMBEDS       : ['message_id', 'title', 'description', 'url', 'timestamp', 'color', 'footer_text', 'footer_icon', 'thumbnail_url', 'image_url', 'author_name', 'author_url', 'author_icon'],
	EMBED_FIELDS : ['embed_id', 'name', 'value', 'inline']
}

// yeah, I know this is a pain to read, but I don't know how else to do this :sob:
const TABLE_QUERIES = {
	GUILDS	: `INSERT INTO Guilds   (${TABLE_COLUMNS.GUILDS.join(', ')  } ) VALUES (${'?,'.repeat(TABLE_COLUMNS.GUILDS.length   - 1)} ? ) ON DUPLICATE KEY UPDATE name = VALUES(name)`,
	CHANNELS: `INSERT INTO Channels (${TABLE_COLUMNS.CHANNELS.join(', ')} ) VALUES (${'?,'.repeat(TABLE_COLUMNS.CHANNELS.length - 1)} ? ) ON DUPLICATE KEY UPDATE name = VALUES(name)`,
	USERS	: `INSERT INTO Users    (${TABLE_COLUMNS.USERS.join(', ')   } ) VALUES (${'?,'.repeat(TABLE_COLUMNS.USERS.length    - 1)} ? ) ON DUPLICATE KEY UPDATE username = VALUES(username)`,

	STICKERS: `INSERT INTO Stickers (${TABLE_COLUMNS.STICKERS.join(', ')} ) VALUES (${'?,'.repeat(TABLE_COLUMNS.STICKERS.length - 1)} ? ) ON DUPLICATE KEY UPDATE name = VALUES(name)`,
	EMOJIS	: `INSERT INTO Emojis   (${TABLE_COLUMNS.EMOJIS.join(', ')  } ) VALUES (${'?,'.repeat(TABLE_COLUMNS.EMOJIS.length   - 1)} ? ) ON DUPLICATE KEY UPDATE name = VALUES(name)`,

	// these don't have ON DUPLICATE KEY UPDATE because there should never be any duplicates
	MESSAGES	: `INSERT INTO Messages      (${TABLE_COLUMNS.MESSAGES.join(', ')    } ) VALUES (${'?,'.repeat(TABLE_COLUMNS.MESSAGES.length     - 1)} ?)`,
	EMOJI_COUNTS: `INSERT INTO MessageEmojis (${TABLE_COLUMNS.EMOJI_COUNTS.join(', ')} ) VALUES (${'?,'.repeat(TABLE_COLUMNS.EMOJI_COUNTS.length - 1)} ?)`,
	ATTACHMENTS	: `INSERT INTO Attachments   (${TABLE_COLUMNS.ATTACHMENTS.join(', ') } ) VALUES (${'?,'.repeat(TABLE_COLUMNS.ATTACHMENTS.length  - 1)} ?)`,
	EMBEDS		: `INSERT INTO Embeds        (id, ${TABLE_COLUMNS.EMBEDS.join(', ')  } ) VALUES (${'?,'.repeat(TABLE_COLUMNS.EMBEDS.length)} ?)`, // notice the missing -1, that's for the `id` column
	EMBED_FIELDS: `INSERT INTO EmbedFields   (${TABLE_COLUMNS.EMBED_FIELDS.join(', ')} ) VALUES (${'?,'.repeat(TABLE_COLUMNS.EMBED_FIELDS.length - 1)} ?)`
}

function TransformForInsert(columns, cache) {
	if (!columns || !cache) throw new TypeError('Columns and cache are required');

	const values =
		Array.isArray(cache)		? cache :
		cache instanceof Map		? Array.from(cache.values()) :
		typeof cache === 'object'	? Object.values(cache) : null;

	if (!values) throw new TypeError('Cache must be an array, map, or object');

	if (values.length === 0) return [];

	const output = [];
	for (let i = 0; i < values.length; i++) {
		output.push( columns.map(col => values[i][col] ?? null) );
	}

	return output;
}

function CreateCache() {
	return {
		messages: [], // { id, guild_id, channel_id, user_id, content, reply_to, sticker_id }

		guilds: new Map(), // guild_id -> { id, name }
		channels: new Map(), // channel_id -> { id, guild_id, name, type }
		users: new Map(), // user_id -> { id, username, bot }

		stickers: new Map(), // sticker_id -> { id, name, format }
		emojis: new Map(), // emoji_id -> { id, name, animated }

		emojiCounts: {}, // message_id -> emoji_id -> count

		attachments: [], // { id, message_id, name }[]
		embeds: [], // { message_id, title, description, url, timestamp, color, footer_text, footer_icon, thumbnail_url, image_url, author_name, author_url, author_icon }[]

		downloadQueue: new Map(), // discord_id -> { type, id, name, url, width, height }
	}
}

let InsertCache = CreateCache();

function EnqueueMessage(simplified) {
	// Message
	InsertCache.messages.push({
		id: simplified.id,
		guild_id: simplified.guild.id,
		channel_id: simplified.channel.id,
		user_id: simplified.user.id,
		content: simplified.content,
		reply_to: simplified.reply_to,
		sticker_id: simplified.sticker?.id || null
	});

	// Guild
	InsertCache.guilds.set(simplified.guild.id, {
		id: simplified.guild.id,
		name: simplified.guild.name
	});

	if (simplified.guild.icon) {
		InsertCache.downloadQueue.set(simplified.guild.id, {
			type	: ASSET_TYPE.GUILD,
			id		: simplified.guild.id,
			url		: simplified.guild.icon.url,
			name	: simplified.guild.icon.name,
			width	: simplified.guild.icon.width,
			height	: simplified.guild.icon.height
		});
	}

	// Channel
	InsertCache.channels.set(simplified.channel.id, {
		id: simplified.channel.id,
		guild_id: simplified.guild.id,
		name: simplified.channel.name,
		type: simplified.channel.type
	});

	// User
	InsertCache.users.set(simplified.user.id, {
		id: simplified.user.id,
		username: simplified.user.username,
		bot: simplified.user.bot
	});

	if (simplified.user.icon) {
		InsertCache.downloadQueue.set(simplified.user.id, {
			type	: ASSET_TYPE.USER,
			id		: simplified.user.id,
			url		: simplified.user.icon.url,
			name	: simplified.user.icon.name,
			width	: simplified.user.icon.width,
			height	: simplified.user.icon.height
		});
	}

	// Sticker
	if (simplified.sticker) {
		InsertCache.stickers.set(simplified.sticker.id, {
			id: simplified.sticker.id,
			name: simplified.sticker.name
		});
		if (simplified.sticker.icon) {
			InsertCache.downloadQueue.set(simplified.sticker.id, {
				type	: ASSET_TYPE.STICKER,
				id		: simplified.sticker.id,
				url		: simplified.sticker.icon.url,
				name	: simplified.sticker.icon.name,
				width	: simplified.sticker.icon.width,
				height	: simplified.sticker.icon.height
			});
		}
	}

	if (simplified.emojis.length > 0) {
		// Emojis
		const emojiCount = {};
		for (const emoji of simplified.emojis) {
			InsertCache.emojis.set(emoji.id, {
				id: emoji.id,
				name: emoji.name,
				animated: emoji.animated
			});

			emojiCount[emoji.id] = (emojiCount[emoji.id] ?? 0) + 1;

			InsertCache.downloadQueue.set(emoji.id, {
				type	: ASSET_TYPE.EMOJI,
				id		: emoji.id,
				url		: emoji.url,
				name	: emoji.name,
				width	: emoji.width,
				height	: emoji.height
			});
		}

		InsertCache.emojiCounts[simplified.id] = emojiCount;
	}

	// Attachments
	for (const attachment of simplified.attachments) {
		InsertCache.attachments.push({
			id: attachment.id,
			message_id: simplified.id,
			name: attachment.name
		});

		// do not add to cache, send directly to queue since it is SUPER short-lived o_o
		AddDownloadToQueue({
			type: ASSET_TYPE.ATTACHMENT,
			id: attachment.id,
			url: attachment.url,
			name: attachment.name,
			width: attachment.width,
			height: attachment.height
		});
	}

	// Embeds
	for (const embed of simplified.embeds) {
		InsertCache.embeds.push({
			message_id: simplified.id,
			title: embed.title,
			description: embed.description,
			url: embed.url,
			timestamp: embed.timestamp,
			color: embed.color,
			footer_text: embed.footer?.text || null,
			footer_icon: embed.footer?.icon || null,
			thumbnail_url: embed.thumbnail?.url || null,
			image_url: embed.image?.url || null,
			author_name: embed.author?.name || null,
			author_url: embed.author?.url || null,
			author_icon: embed.author?.icon || null,

			fields: embed.fields // no work needed, already in the correct format lol
		});
	}

	if (InsertCache.messages.length >= MAX_CACHE_SIZE) {
		setImmediate(Flush);

		// no need to check for downloads
		// Flush() already triggers the download process
		return;
	}

	if (simplified.attachments.length > 0) {
		// if there are attachments, download immediately to avoid them being lost
		setImmediate(DownloadAssets);
	}
}

function ObjectEquals(a, b) {
	if (a === b) return true;
	if (typeof a !== 'object' || typeof b !== 'object') return false;
	if (a === null || b === null) return false;

	const aKeys = Object.keys(a);
	const bKeys = Object.keys(b);
	if (aKeys.length !== bKeys.length) return false;

	for (const key of aKeys) {
		if (a[key] !== b[key]) return false;
	}

	return true;
}

function RemoveUnchangedEntities(cache, lru) {
	if (!(cache instanceof Map)) throw new TypeError('Expected cache to be a Map');

	if (cache.size === 0) return;

	for (const [id, entity] of cache) {
		const cached = lru.get(id);
		if (!lru.has(id)) {
			// assume new entity
			lru.set(id, entity);
			continue;
		}

		if (!ObjectEquals(entity, cached)) {
			// entity has changed
			lru.set(id, entity);
		} else {
			// entity is unchanged, remove from cache to avoid re-inserting
			cache.delete(id);
		}
	}
}

let timeout = setTimeout(Flush, FLUSH_INTERVAL);
async function Flush(chanelID = null) {
	// reset timeout
	clearTimeout(timeout);
	timeout = setTimeout(Flush, FLUSH_INTERVAL);

	if (InsertCache.messages.length === 0) return; // nothing to do

	if (chanelID && !InsertCache.channels.has(chanelID)) return; // nothing to do for this channel

	// swap reference and create a new cache to fill up
	const savedCache = InsertCache;
	InsertCache = CreateCache();

	RemoveUnchangedEntities(savedCache.guilds  , GUILD_CACHE   );
	RemoveUnchangedEntities(savedCache.channels, CHANNEL_CACHE );
	RemoveUnchangedEntities(savedCache.users   , USER_CACHE    );
	RemoveUnchangedEntities(savedCache.stickers, STICKER_CACHE );
	RemoveUnchangedEntities(savedCache.emojis  , EMOJI_CACHE   );

	const guildInserts		= TransformForInsert(TABLE_COLUMNS.GUILDS     , savedCache.guilds      );
	const channelInserts	= TransformForInsert(TABLE_COLUMNS.CHANNELS   , savedCache.channels    );
	const userInserts		= TransformForInsert(TABLE_COLUMNS.USERS      , savedCache.users       );
	const stickerInserts	= TransformForInsert(TABLE_COLUMNS.STICKERS   , savedCache.stickers    );
	const emojiInserts		= TransformForInsert(TABLE_COLUMNS.EMOJIS     , savedCache.emojis      );
	const messageInserts	= TransformForInsert(TABLE_COLUMNS.MESSAGES   , savedCache.messages    );
	const attachmentInserts = TransformForInsert(TABLE_COLUMNS.ATTACHMENTS, savedCache.attachments );

	const connection = await Database.getConnection();

	// embeds and their fields are a bit more complicated
	let nextEmbedID = await connection.query('SELECT MAX(id) + 1 as id FROM Embeds').then(res => res[0]?.id ?? 1);
	const embedInserts = [];
	const embedFieldInserts = [];
	for (const embed of savedCache.embeds) {
		const embedID = nextEmbedID++;
		embedInserts.push([
			embedID,
			embed.message_id,
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
		]);

		for (const field of embed.fields) {
			embedFieldInserts.push([
				embedID,
				field.name,
				field.value,
				field.inline ? 1 : 0
			]);
		}
	}

	// lastly, the emoji inserts
	const emojiCountInserts = [];
	for (const [messageID, emojiCounts] of Object.entries(savedCache.emojiCounts)) {
		for (const [emojiID, count] of Object.entries(emojiCounts)) {
			emojiCountInserts.push([
				messageID,
				emojiID,
				count
			]);
		}
	}

	let failures = []; // { query: string, values: any[][] }[]

	await connection.beginTransaction();

	try {
		if (guildInserts.length      > 0) failures.push( await AttemptInsert(connection, TABLE_QUERIES.GUILDS      , guildInserts      ));
		if (channelInserts.length    > 0) failures.push( await AttemptInsert(connection, TABLE_QUERIES.CHANNELS    , channelInserts    ));
		if (userInserts.length       > 0) failures.push( await AttemptInsert(connection, TABLE_QUERIES.USERS       , userInserts       ));
		if (stickerInserts.length    > 0) failures.push( await AttemptInsert(connection, TABLE_QUERIES.STICKERS    , stickerInserts    ));
		if (emojiInserts.length      > 0) failures.push( await AttemptInsert(connection, TABLE_QUERIES.EMOJIS      , emojiInserts      ));
		if (messageInserts.length    > 0) failures.push( await AttemptInsert(connection, TABLE_QUERIES.MESSAGES    , messageInserts    ));
		if (emojiCountInserts.length > 0) failures.push( await AttemptInsert(connection, TABLE_QUERIES.EMOJI_COUNTS, emojiCountInserts ));
		if (attachmentInserts.length > 0) failures.push( await AttemptInsert(connection, TABLE_QUERIES.ATTACHMENTS , attachmentInserts ));
		if (embedInserts.length      > 0) failures.push( await AttemptInsert(connection, TABLE_QUERIES.EMBEDS      , embedInserts      ));
		if (embedFieldInserts.length > 0) failures.push( await AttemptInsert(connection, TABLE_QUERIES.EMBED_FIELDS, embedFieldInserts ));
		await connection.commit();
	} catch (err) {
		await connection.rollback();
		Log.error(err);
	} finally {
		Database.releaseConnection(connection);
	}

	failures = failures.filter(Boolean);
	if (failures.length > 0) {
		console.log(failures);
		const totalRowsFailed = failures.reduce((sum, f) => sum + f.length, 0);
		Log.error(`Failed to insert ${totalRowsFailed} rows into the database, saving to disk for later analysis`);
		const timestamp = Log.getTimestamp().replace(/[:\s]/g, '-');
		const filename = `${FAILED_MESSAGES}/${timestamp}.log`;
		const contents = failures.map(f => `-- ${f.query}\n${f.values.map(v => JSON.stringify(v)).join('\n')}\n`).join('\n\n');
		await fs.promises.writeFile(filename, contents);
	}

	for (const asset of savedCache.downloadQueue.values()) {
		AddDownloadToQueue(asset);
	}

	// kick off the download process if not already running
	setImmediate(DownloadAssets);
}

async function AttemptInsert(connection, query, inserts) {
	const failed = await SafeBulkInsert(connection, query, inserts);
	return failed.length > 0 ? { query, values: failed } : null;
}

async function SafeBulkInsert(connection, query, values = [], depth = 0) {
	if (values.length === 0) return [];
	if (depth > 10) { // 2^10 = 1024, limit is only 100 so should never reach this point
		Log.error( new Error('Maximum recursion depth, aborting!') );
		return values;
	}
	try {
		await connection.batch(query, values); // any[][]
		return [];
	} catch (err) {

		if (values.length === 1) {
			Log.debug(`Found bad row at depth ${depth}`);
			console.log(values);
			Log.error(err);
			// found the poison row!
			return values;
		}

		// split and retry
		const mid = Math.floor(values.length / 2);
		const firstHalf = values.slice(0, mid);
		const secondHalf = values.slice(mid);

		const failedFirst = await SafeBulkInsert(connection, query, firstHalf, depth + 1);
		const failedSecond = await SafeBulkInsert(connection, query, secondHalf, depth + 1);

		return failedFirst.concat(failedSecond);
	}
}

module.exports = {
	FlushMessages: Flush,

	name: 'messageCreate',
	execute: async function (client, message) {
		if (!message.guild) return; // DM messages are not supported

		if (message.flags.has(128)) return; // deferred message

		const accepted = await GetGuildTOS(message.guild.id);
		if (!accepted) return; // server owner must accept TOS before collecting data

		if (message.author.id === client.user.id) return; // self

		// Simplify the message for easier access
		const simplified = SimplifyMessage(message);

		EnqueueMessage(simplified);
	}
}