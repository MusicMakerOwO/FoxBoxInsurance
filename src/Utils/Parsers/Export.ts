import {
	Asset,
	SimpleChannel,
	SimpleEmoji,
	SimpleGuild,
	SimpleMessage,
	SimpleSticker,
	SimpleUser
} from "../../Typings/DatabaseTypes";
import { FORMAT, FORMAT_NAMES } from "../Constants";
import { PoolConnection } from "mariadb";
import { Database } from "../../Database";
import { ObjectValues } from "../../Typings/HelperTypes";
import { GetUser } from "../../CRUD/Users";
import { GetAsset } from "../../CRUD/Assets";
import { GetSticker } from "../../CRUD/Stickers";
import { GetEmoji } from "../../CRUD/Emojis";
import { createHash } from "node:crypto";
import { JSONReplacer } from "../../JSON";
import { readFileSync } from "node:fs";
import { client } from "../../Client";
import { ResolveUserKeyBulk } from "../../Services/UserEncryptionKeys";
import { Decrypt } from "../Encryption";

function Omit<T extends {}, K extends keyof T>(data: T, props: K[]): Omit<T, K> {
	const result = { ...data };
	for (const key of props) {
		delete result[key];
	}
	return result;
}

function UTCDate(date: Date) {
	const year = date.getUTCFullYear();
	const month = date.getUTCMonth();
	const day = date.getUTCDate();
	return `${year} ${MONTHS[month]} ${day}`;
}

function UTCTime(date: Date) {
	let hour = date.getUTCHours();
	const minute = date.getUTCMinutes()
	.toString()
	.padStart(2, '0')
	// const second = date.getUTCSeconds().toString().padStart(2, '0')

	const timing = hour > 12 ? (hour -= 12, 'pm') : 'am';

	return `${hour}:${minute}${timing} UTC`;
}

const MONTHS = [
	'January',
	'February',
	'March',
	'April',
	'May',
	'June',
	'July',
	'August',
	'September',
	'October',
	'November',
	'December'
] as const;

const missingAsset = readFileSync(`${__dirname}/../../../missing.png`);

const HASH_ALGORITHM = 'sha256';

export type ExportOptions = {
	guildID: SimpleGuild['id'];
	channelID: SimpleChannel['id'];
	userID: SimpleUser['id'];
	format: ObjectValues<typeof FORMAT>;
	messageCount: number;
}

const chars = 'ABCDEFGHKLMNPQRSTVWXYZ23456789';

async function GenerateExportID(connection: PoolConnection, attempts = 5): Promise<string> {
	if (attempts <= 0) throw new Error('Failed to generate export ID');
	// XXXX-XXXX-XXXX-XXXX
	const id = [];
	for (let i = 0; i < 4; i++) {
		for (let j = 0; j < 4; j++) {
			id.push(chars[Math.floor(Math.random() * chars.length)]);
		}
		if (i !== 3) id.push('-');
	}
	const idString = id.join('');
	const [exists] = await connection.query('SELECT id FROM Exports WHERE id = ?', [idString]);
	return exists ? GenerateExportID(connection, attempts - 1) : idString;
}

type ExportContext = {
	owner: Pick<SimpleUser, 'id' | 'username' | 'bot'>;
	id: string;
	guild: Pick<SimpleGuild, 'id' | 'name'>;
	channel: Pick<SimpleChannel, 'id' | 'name' | 'type'>;

	users: Map<SimpleUser['id'], Pick<SimpleUser, 'id' | 'username' | 'bot'> | null>;
	emojis: Map<SimpleEmoji['id'], SimpleEmoji | null>;
	stickers: Map<SimpleSticker['id'], SimpleSticker | null>;
	assets: Map<Asset['discord_id'], Asset | null>;

	options: ExportOptions;

	messages: Pick<SimpleMessage, 'id' | 'user_id' | 'content' | 'sticker_id' | 'reply_to' | 'data' | 'created_at'>[];
}

export async function ExportChannel(options: ExportOptions) {

	if (options.messageCount < 1) throw new Error('Cannot export 0 messages');
	if (options.messageCount > 10_000) throw new Error('Cannot export more than 10,000 messages');

	const connection = await Database.getConnection();

	const selectedMessageIDs = await connection.query(`
        SELECT id
        FROM Messages
        WHERE channel_id = ?
        ORDER BY id DESC
        LIMIT ?
	`, [options.channelID, options.messageCount]) as Pick<SimpleMessage, 'id'>[]

	const context: ExportContext = {
		owner  : await connection.query('SELECT id, username, bot FROM Users WHERE id = ?', [options.userID])
		.then(res => res[0]),
		id     : await GenerateExportID(connection),
		guild  : await connection.query('SELECT id, name FROM Guilds WHERE id = ?', [options.guildID])
		.then(res => res[0]),
		channel: await connection.query('SELECT id, name, type FROM Channels WHERE id = ?', [options.channelID])
		.then(res => res[0]),

		users   : new Map(),
		emojis  : new Map(),
		stickers: new Map(),
		assets  : new Map(),

		options: options,

		messages: new Array(selectedMessageIDs.length)
	}

	selectedMessageIDs.reverse();

	const encryptedMessages = await connection.query(`
        SELECT id, user_id, content, sticker_id, reply_to, data, created_at, encryption_version
        FROM Messages
        WHERE id IN (${'?,'.repeat(selectedMessageIDs.length - 1)}?)
	`, selectedMessageIDs.map(m => m.id)) as Pick<SimpleMessage, 'id' | 'user_id' | 'content' | 'sticker_id' | 'reply_to' | 'data' | 'created_at' | 'encryption_version'>[]

	const encryptedUserIDs = encryptedMessages.map(m => m.user_id);
	const keys = await ResolveUserKeyBulk(encryptedUserIDs);

	for (let i = 0; i < encryptedMessages.length; i++) {
		const message = encryptedMessages[i];
		if (message.encryption_version && message.content !== null) {
			const userKey = keys.get(message.user_id);
			if (!userKey) throw new Error(`Failed to get key for user ${message.user_id}`);
			message.content = Decrypt(message.content, userKey, message.encryption_version);
		}
		context.messages[i] = Omit(message, ['encryption_version']);
	}

	const userIDs = new Set<SimpleUser['id']>();
	const stickerIDs = new Set<SimpleSticker['id']>();
	const emojiIDs = new Set<SimpleEmoji['id']>();

	for (const msg of encryptedMessages) {
		userIDs.add(msg.user_id);
		if (msg.sticker_id) stickerIDs.add(msg.sticker_id);
		for (const emojiID of msg.data.emoji_ids) {
			emojiIDs.add(BigInt(emojiID))
		}
	}

	const assetIDs = new Set<bigint>([... userIDs, ... stickerIDs, ... emojiIDs]);

	for (const msg of encryptedMessages) {
		for (const attachment of msg.data.attachments) {
			assetIDs.add(BigInt(attachment.id));
		}
	}

	for (const userID of userIDs) {
		const user = await GetUser(userID);
		context.users.set(userID, user ? {
			id      : user.id,
			username: user.username,
			bot     : user.bot
		} : null);
	}
	for (const stickerID of stickerIDs) {
		const sticker = await GetSticker(stickerID);
		context.stickers.set(stickerID, sticker ? {
			id  : sticker.id,
			name: sticker.name
		} : null);
	}
	for (const emojiID of emojiIDs) {
		const emoji = await GetEmoji(emojiID);
		context.emojis.set(emojiID, emoji ? {
			id      : emoji.id,
			name    : emoji.name,
			animated: emoji.animated
		} : null);
	}

	for (const assetID of assetIDs) {
		const asset = await GetAsset(assetID);
		context.assets.set(assetID, asset ? {
			discord_id : asset.discord_id,
			type       : asset.type,
			discord_url: asset.discord_url,
			name       : asset.name,
			width      : asset.width,
			height     : asset.height,
			size       : asset.size,
			hash       : asset.hash
		} : null);
	}


	let fileData = Buffer.from(''); // empty buffer
	switch (options.format) {
		case FORMAT.TEXT :
			fileData = Buffer.from(ExportText(context));
			break;
		case FORMAT.JSON :
			fileData = Buffer.from(JSON.stringify(ExportJSON(context), JSONReplacer, 0));
			break;
		case FORMAT.HTML :
			fileData = Buffer.from(ExportHTML(context));
			break;
		default:
			throw new Error('Invalid format');
	}

	// memes_export.txt
	const fileName = context.channel.name + '_export.' + FORMAT_NAMES[options.format].toLowerCase();
	const hash = createHash('sha256')
	.update(fileName)
	.digest('hex');

	Database.releaseConnection(connection);

	return {
		id  : context.id,
		name: fileName,
		hash: [HASH_ALGORITHM, hash] as [typeof HASH_ALGORITHM, string],
		data: fileData
	}
}

function ExportText(context: ExportContext) {
	const output = new Array<string>();

	/*
	 [2025-03-23T18:56:56.000Z] username: message
	 ?[STICKER] <sticker name>
	 ?[ATTACHMENTS] <n> files
	 ?[EMBEDS] <n> embeds
	 \n
	 */

	output.push(`Exported by @${context.owner.username} (${context.owner.id})`);
	output.push(`Guild: ${context.guild.name} (${context.guild.id})`);
	output.push(`Channel: #${context.channel.name} (${context.channel.id})`);
	output.push(`=========================`);
	output.push(`Export ID: ${context.id}`);
	output.push('This file has been generated by FBI - https://www.notfbi.dev/invite');
	output.push('You can check if the export has been tampered with by using /verify and the ID above\n');

	for (let i = 0; i < context.messages.length; i++) {
		const message = context.messages[i];
		const prevMessage = context.messages[i - 1];

		const messageDate = new Date(message.created_at);

		const stepsOverDay = !prevMessage || new Date(prevMessage.created_at).getUTCDay() !== messageDate.getUTCDay();

		const user = context.users.get(message.user_id) ?? { id: message.user_id, username: 'unknown_user', bot: 0 };
		const sticker = context.stickers.get(message.sticker_id!) ?? {
			id  : message.sticker_id,
			name: 'Unknown Sticker'
		};
		const { attachments, embeds } = message.data;

		const line: string[] = [];

		if (stepsOverDay) line.push(`---------- [ ${UTCDate(messageDate)} ] ----------\n`);

		line.push(`@${user.username} [${UTCTime(messageDate)}]`);
		if (message.content && message.content.length > 0) line.push(message.content.toString());
		if (message.sticker_id && sticker) line.push(`<STICKER> ${sticker.name}`);
		if (attachments.length > 0) line.push(`<ATTACHMENTS> ${message.data.attachments.length} files`);
		if (embeds.length > 0) line.push(`<EMBEDS> ${message.data.embeds.length} embeds`);
		output.push(line.join('\n') + '\n');
	}

	return output.join('\n')
	.trim();
}

export type JSONExport = ReturnType<typeof ExportJSON>;

function ExportJSON(context: ExportContext) {
	type ExportedMessage = typeof context.messages[0] & { content: string | null }
	const guild = client.guilds.cache.get(context.guild.id.toString());
	const serverRoles = Array.from(guild ? guild.roles.cache.entries() : [])
	.map(([_, x]) => [_, { name: x.name, color: x.color }]);
	const output = {
		export  : {
			owner  : `@${context.owner.username} (${context.owner.id})`,
			guild  : `${context.guild.name} (${context.guild.id})`,
			channel: `#${context.channel.name} (${context.channel.id})`,
			id     : context.id,
			warning: `
This export has been generated by FBI : https://www.notfbi.dev/invite
You can check if the export has been tampered with by using /verify and the ID above`.trim()
		},
		guild   : context.guild,
		channel : context.channel,
		roles   : Object.fromEntries(serverRoles),
		users   : Object.fromEntries(context.users.entries()
		.map(([id, x]) => [Number(id), x])),
		emojis  : Object.fromEntries(context.emojis.entries()
		.map(([id, x]) => [Number(id), x])),
		stickers: Object.fromEntries(context.stickers.entries()
		.map(([id, x]) => [Number(id), x])),
		assets  : Object.fromEntries(context.assets.entries()
		.map(([id, x]) => [Number(id), x])),
		messages: new Array<ExportedMessage>(context.messages.length)
	};
	for (let i = 0; i < context.messages.length; i++) {
		const msg = context.messages[i];
		output.messages[i] = {
			... msg,
			content: msg.content?.toString() ?? null
		} as ExportedMessage
	}
	return output;
}

function ExportHTML(context: ExportContext) {
	const lookups = ExportJSON(context);

	const TEMPLATES = {
		username   : context.owner.username,
		userid     : context.owner.id,
		guildname  : context.guild.name,
		guildid    : context.guild.id,
		channelid  : context.channel.id,
		channelname: context.channel.name,
		exportid   : context.id,
		lookup     : JSON.stringify(lookups, JSONReplacer, 4),
		missing    : missingAsset.toString('base64')
	} as const;

	let page = readFileSync(`${__dirname}/../../../page.html`, 'utf-8');

	// {{name}}
	const templateRegex = /\{\{([a-zA-Z0-9_]+)}}/g;
	const templatesUsed = page.match(templateRegex) ?? [];
	for (const template of templatesUsed) {
		const key = template.replace(templateRegex, '$1');
		if (key in TEMPLATES) {
			page = page.replaceAll(template, TEMPLATES[key as keyof typeof TEMPLATES].toString());
		} else {
			throw new Error(`Template ${key} not found`);
		}
	}

	return page;
}