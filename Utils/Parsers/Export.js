const { FORMAT } = require("../Constants");
const Database = require("../Database");
const { readFileSync } = require("fs");
const { minify } = require("html-minifier");
const crypto = require("crypto");
const { promisify } = require("util");
const ResolveUserKey = require("../ResolveUserKey");

const missingAsset = readFileSync(`${__dirname}/../../missing.png`);

const DEFAULT_OPTIONS = {
	guildID: '',
	channelID: '',
	userID: '',
	format: FORMAT.TEXT,
	messageCount: 100,
	lastMessageID: ''
}

function BatchCache(list = [{}], property = '', table = '', column = '') {
	if (typeof list[0] === 'object') list = list.map(m => m?.[property]);
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

const chars = 'ABCDEFGHKLMNPQRSTVWXYZ23456789';
function GenerateExportID(attempts = 5) {
	if (attempts <= 0) throw new Error('Failed to generate export ID');
	// XXXX-XXXX-XXXX-XXXX
	const id = [];
	for (let i = 0; i < 4; i++) {
		for (let j = 0; j < 4; j++) {
			id.push( chars[Math.floor(Math.random() * chars.length)] );
		}
		if (i !== 3) id.push('-');
	}
	const idString = id.join('');
	const exists = Database.prepare('SELECT * FROM Exports WHERE id = ?').get(idString);
	return exists ? GenerateExportID(attempts - 1) : idString;
}

function SimplifyMessage(message) {
	// Simplify message object to only include necessary fields
	return {
		id: message.id,
		user_id: message.user_id,
		content: message.content || null,
		sticker_id: message.sticker_id,
		created_at: message.created_at,
		reply_to: message.reply_to || null // assuming reply_to is a field in the message
	};
}

module.exports = async function Export(options = DEFAULT_OPTIONS) {
	
	const Context = {
		Owner: Database.prepare('SELECT * FROM Users WHERE id = ?').get(options.userID),
		ID: GenerateExportID(),
		Guild: Database.prepare('SELECT * FROM Guilds WHERE id = ?').get(options.guildID),
		Channel: Database.prepare('SELECT * FROM Channels WHERE id = ?').get(options.channelID),
		
		Users: new Map(),
		Emojis: new Map(),
		Stickers: new Map(),
		Files: new Map(),

		Assets: new Map(),
		Embeds: new Map(), // message_id -> embed[]
		EmbedFields: new Map(), // embed_id -> field[]

		Options: options.options,
		Messages: new Array( options.messageCount ).fill({})
	}

	if (options.messageCount < 1) throw new Error('Cannot export 0 messages');

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

	console.log(`Decrypting ${messages.length} messages...`);

	const decryptStart = process.hrtime.bigint();
	for (let i = 0; i < messages.length; i++) {
		const message = messages[i];
		if (message.encrypted === 0) continue;
		if (message.content === null) continue;

		const key = ResolveUserKey(message.user_id);
		if (!key) throw new Error(`Failed to get key for user ${message.user_id}`);
	
		const iv = crypto.createHash('sha256').update(`${message.id}${message.user_id}`).digest('hex').slice(0, 16);
		const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
		decipher.setAuthTag(Buffer.from(message.tag, 'base64'));
		
		const decrypted = decipher.update(message.content, 'base64', 'utf8') + decipher.final('utf8');
		
		message.content = decrypted;
	}
	const decryptEnd = process.hrtime.bigint();
	const decryptTime = Number(decryptEnd - decryptStart) / 1e6;
	console.log(`Decrypted ${messages.length} messages in ${decryptTime.toFixed(2)}ms (${(messages.length / (decryptTime * 1000)).toFixed(2)} msg/s)`);

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

	const EmbedIDs = Database.prepare(`
		SELECT id
		FROM Embeds
		WHERE message_id IN ( ${'?,'.repeat(messages.length - 1)}? )
	`).all(...messages.map(m => m.id));
	const Embeds = BatchCache(EmbedIDs, 'id', 'Embeds', 'id');
	for (const embed of Embeds.values()) {
		// Map() : message_id -> embed[]
		if (!Context.Embeds.has(embed.message_id)) {
			Context.Embeds.set(embed.message_id, [embed]);
		} else {
			Context.Embeds.get(embed.message_id).push(embed);
		}
	}

	if (EmbedIDs.length > 0) {
		const EmbedFieldIDs = Database.prepare(`
			SELECT id
			FROM EmbedFields
			WHERE embed_id IN ( ${'?,'.repeat(EmbedIDs.length - 1)}? )
		`).all(...EmbedIDs.map(m => m.id));
		const Fields = BatchCache(EmbedFieldIDs, 'id', 'EmbedFields', 'id');
		for (const field of Fields.values()) {
			// Map() : embed_id -> field[]
			if (!Context.EmbedFields.has(field.embed_id)) {
				Context.EmbedFields.set(field.embed_id, [field]);
			} else {
				Context.EmbedFields.get(field.embed_id).push(field);
			}
		}
	}

	const AssetIDs = [
		... Array.from(Context.Users.values()	).map(x => x.asset_id),
		... Array.from(Context.Stickers.values()).map(x => x.asset_id),
		... Array.from(Context.Emojis.values()	).map(x => x.asset_id),
		// files are unique, it's an array of files, we need to extact the asset_id from each
		... Array.from(Context.Files.values()	).map(x => x.map(f => f.asset_id)).flat()
	];

	Context.Assets = BatchCache(AssetIDs, 'id', 'Assets', 'asset_id');

	// strip out sensitive or useless data
	Context.Messages = Context.Messages.map(SimplifyMessage);

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
		id: Context.ID,
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

	output.push(`Exported by @${Context.Owner.username} (${Context.Owner.id})`);
	output.push(`Guild: ${Context.Guild.name} (${Context.Guild.id})`);
	output.push(`Channel: #${Context.Channel.name} (${Context.Channel.id})`);
	output.push(`=========================`);
	output.push(`Export ID: ${Context.ID}`);
	output.push('This file has been generated by FBI - https://www.notfbi.dev/invite');
	output.push('You can check if the export has been tampered with by using /verify and the ID above\n');

	for (const message of Context.Messages) {
		const user = Context.Users.get(message.user_id);
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
		export: {
			owner: `@${Context.Owner.username} (${Context.Owner.id})`,
			guild: `${Context.Guild.name} (${Context.Guild.id})`,
			channel: `#${Context.Channel.name} (${Context.Channel.id})`,
			id: Context.ID,
			warning: `
This export has been generated by FBI : https://www.notfbi.dev/invite
You can check if the export has been tampered with by using /verify and the ID above`.trim()
		},
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

	output.push(`Exported by @${Context.Owner.username} (${Context.Owner.id})`);
	output.push(`Guild: ${Context.Guild.name} (${Context.Guild.id})`);
	output.push(`Channel: #${Context.Channel.name} (${Context.Channel.id})`);
	output.push(`=========================`);
	output.push(`Export ID: ${Context.ID}`);
	output.push('This file has been generated by FBI - https://www.notfbi.dev/invite');
	output.push('You can check if the export has been tampered with by using /verify and the ID above\n');

	// header
	output.push('created_at, user_id, content, sticker_name, attachment_count');

	for (const message of Context.Messages) {
		const user = Context.Users.get(message.user_id);
		const sticker = Context.Stickers.get(message.sticker_id);
		const attachments = Context.Files.get(message.id);

		const line = [
			message.created_at,
			'"' + user.id + "'",
			'"' + (message.content ?? '').replace(/,/g, '').replace(/\n/g, '\\n') + '"',
			sticker?.name,
			attachments?.length ?? 0
		].join(',');

		output.push(line);
	}

	return Buffer.from( output.join('\n').trim() );
}

function ExportHTML(Context) {
	const Lookups = {
		users: Object.fromEntries(Context.Users),
		emojis: Object.fromEntries(Context.Emojis),
		stickers: Object.fromEntries(Context.Stickers),
		files: Object.fromEntries(Context.Files),
		assets: Object.fromEntries(Context.Assets),
		embeds: Object.fromEntries(Context.Embeds),
		fields: Object.fromEntries(Context.EmbedFields)
	}

	for (const [userID, user] of Object.entries(Lookups.users)) {
		// generate a random color for each user
		const r = Math.floor(64 + Math.random() * 192).toString(16).padStart(2, '0');
		const g = Math.floor(64 + Math.random() * 192).toString(16).padStart(2, '0');
		const b = Math.floor(64 + Math.random() * 192).toString(16).padStart(2, '0');
		user.color = `#${r}${g}${b}`; // #000000 -> #ffffff
	}

	const TEMPLATES = {
		username: Context.Owner.username,
		userid: Context.Owner.id,
		guildname: Context.Guild.name,
		guildid: Context.Guild.id,
		channelid: Context.Channel.id,
		channelname: Context.Channel.name,
		exportid: Context.ID,
		lookups: JSON.stringify(Lookups),
		messages: JSON.stringify(Context.Messages),
		missing: missingAsset.toString('base64'),
	}

	for (const [key, value] of Object.entries(TEMPLATES)) {
		if (typeof value !== 'string') {
			throw new Error(`Template ${key} is not a string`);
		}
	}

	let page = readFileSync(`${__dirname}/page.html`, 'utf-8');
	
	// {{name}}
	const templateRegex = /\{\{([a-zA-Z0-9_]+)\}\}/g;
	const templatesUsed = page.match(templateRegex) ?? [];
	for (const template of templatesUsed) {
		const key = template.replace(templateRegex, '$1');
		if (TEMPLATES[key]) {
			page = page.replace(template, TEMPLATES[key]);
		} else {
			throw new Error(`Template ${key} not found`);
		}
	}

	page = minify(page, {
		collapseWhitespace: true,
		minifyCSS: true,
		minifyJS: true,
		removeComments: true
	});

	return Buffer.from(page);
}
