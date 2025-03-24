const { inspect } = require("util");
const { FORMAT } = require("../Constants");
const Database = require("../Database");
const { writeFileSync } = require("fs");

const DEFAULT_OPTIONS = {
	guildID: '',
	channelID: '',
	userID: '',
	format: FORMAT.TEXT,
	messageCount: 100,
	options: {
		bots: true,
		prettyPings: true,
		nicknames: false
	},
	lastMessageID: ''
}

function BatchCache(list = [{}], property = '', table = '', column = '') {
	if (typeof list[0] === 'object') list = list.map(m => m[property]);
	if (list.length === 0) return new Map();
	const IDs = new Set(list);
	const dbData = Database.prepare(`
		SELECT *
		FROM ${table}
		WHERE ${column} IN ( ${'?,'.repeat(IDs.size - 1)}? )
	`).all(...IDs);
	const result = new Map( dbData.map(x => [x[column], x]) );
	return result;
}

module.exports = async function Export(options = DEFAULT_OPTIONS) {
	
	const Context = {
		Guild: Database.prepare('SELECT * FROM Guilds WHERE id = ?').get(options.guildID),
		Channel: Database.prepare('SELECT * FROM Channels WHERE id = ?').get(options.channelID),
		
		Users: new Map(),
		Emojis: new Map(),
		Stickers: new Map(),
		Files: new Map(),

		Assets: new Map(),

		Options: options.options,
		Messages: new Array( options.messageCount ).fill({})
	}

	/*
	{
		id: '1353442409295384640',
		guild_id: '602329986463957025',
		channel_id: '1099802786469777530',
		user_id: '1292277755270008872',
		content: 'hello',
		sticker_id: null,
		created_at: '2025-03-23T18:56:56.000Z'
	}
	*/
	const messages = Database.prepare(`
		SELECT *
		FROM Messages
		WHERE id IN (
			SELECT id
			FROM Messages
			WHERE
				channel_id = ? AND
				id <= ?
			ORDER BY id DESC
			LIMIT ?
		)
	`).all(options.channelID, String(options.lastMessageID), options.messageCount);
	Context.Messages = messages;

	Context.Users 	 = BatchCache(messages, 'user_id', 'Users', 'id');
	Context.Stickers = BatchCache(messages, 'sticker_id', 'Stickers', 'id');

	const EmojiIDs = Database.prepare(`
		SELECT emoji_id
		FROM MessageEmojis
		WHERE message_id IN ( ${'?,'.repeat(messages.length - 1)}? )
	`).all(...messages.map(m => m.id));

	Context.Emojis 	= BatchCache(EmojiIDs, 'emoji_id', 'Emojis', 'id');

	const AttachmentIDs = Database.prepare(`
		SELECT id
		FROM Attachments
		WHERE message_id IN ( ${'?,'.repeat(messages.length - 1)}? )
	`).all(...messages.map(m => m.id));

	const Files = BatchCache(AttachmentIDs, 'id', 'Attachments', 'id'); // fileID -> file
	for (const file of Files.values()) {
		if (!Context.Files.has(file.message_id)) {
			Context.Files.set(file.message_id, [file]);
		} else {
			Context.Files.get(file.message_id).push(file);
		}
	}

	const AssetIDs = [
		... Array.from(Context.Users.values()	).map(x => x.asset_id),
		... Array.from(Context.Stickers.values()).map(x => x.asset_id),
		... Array.from(Context.Emojis.values()	).map(x => x.asset_id),
		... Array.from(Context.Files.values()	).map(x => x.asset_id)
	];

	Context.Assets = BatchCache(AssetIDs, 'id', 'Assets', 'asset_id');

	let fileData = Buffer.from(''); // empty buffer
	switch (options.format) {
		case FORMAT.TEXT : fileData = ExportText(Context); break;
		case FORMAT.JSON : fileData = ExportJSON(Context); break;
		case FORMAT.HTML : fileData = ExportHTML(Context); break;
		case FORMAT.CSV  : fileData = ExportCSV(Context);  break;
		default: throw new Error('Invalid format');
	}

	// memes_export.txt
	const fileName = Context.Channel.name + '_export.' + options.format.toLowerCase();

	return {
		name: fileName,
		data: fileData
	}
}

function ExportText(Context) {
	const output = [];

	/*
	[2025-03-23T18:56:56.000Z] username: message
	?[STICKER] <sticker name>
	?[ATTACHMENTS] <n> files
	?[EMBEDS] <n> embeds
	\n
	*/

	for (const message of Context.Messages) {
		const user = Context.Users.get(message.user_id);
		if (Context.Options.bots === false && user.bot) continue;

		const sticker = Context.Stickers.get(message.sticker_id);
		const attachments = Context.Files.get(message.id);

		let line = `[${message.created_at}] @${user.username}\n`;
		if (message.content) line += message.content + '\n';
		if (sticker) line += `<STICKER> ${sticker.name}\n`;
		if (attachments) line += `<ATTACHMENTS> ${attachments.length} files\n`;
		output.push(line);
	}

	return Buffer.from( output.join('\n').trim() );
}

function ExportJSON(Context) {
	const output = {
		guild: Context.Guild,
		channel: Context.Channel,
		users: Object.fromEntries(Context.Users),
		emojis: Object.fromEntries(Context.Emojis),
		stickers: Object.fromEntries(Context.Stickers),
		files: Object.fromEntries(Context.Files),
		messages: Context.Messages
	}

	return Buffer.from(JSON.stringify(output));
}

function ExportCSV(Context) {
	const output = [];

	// header
	output.push('created_at, user_id, content, sticker_name, attachment_count');

	for (const message of Context.Messages) {
		const user = Context.Users.get(message.user_id);
		if (Context.Options.bots === false && user.bot) continue;

		const sticker = Context.Stickers.get(message.sticker_id);
		const attachments = Context.Files.get(message.id);

		const line = [
			message.created_at,
			user.id,
			message.content?.replace(/,/g, ''),
			sticker?.name,
			attachments?.length ?? 0
		].join(',');

		output.push(line);
	}

	return Buffer.from( output.join('\n').trim() );
}