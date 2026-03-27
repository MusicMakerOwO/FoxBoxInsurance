import {EventHandler} from "../Typings/HandlerTypes";
import {GetGuild} from "../CRUD/Guilds";
import { Channel, Emoji, Guild, GuildBasedChannel, Message, MessageFlags, Sticker, User } from "discord.js";
import { GUILD_FEATURES, SimpleEmoji, SimpleMessage } from "../Typings/DatabaseTypes";
import {SECONDS} from "../Utils/Constants";
import {Database} from "../Database";
import {Log} from "../Utils/Log";
import {PoolConnection} from "mariadb";
import {JSONReplacer} from "../JSON";
import {ASSET_TYPE, QueueDownload} from "../Utils/Processing/Images";

export default {
	name: 'messageCreate',
	execute: async function(message: Message<true>) {
		if (!message.guild) return; // DM messages are not supported

		if (message.flags.has(128)) return; // deferred message

		const savedGuild = await GetGuild(message.guildId);
		if (!savedGuild) return;
		if ( (savedGuild.features & GUILD_FEATURES.MESSAGE_SAVING) === 0) return;

		if (message.flags.has(MessageFlags.Ephemeral)) return;

		QueueMessageForProcessing(message);

		for (const attachment of message.attachments.values()) {
			QueueDownload({
				type: ASSET_TYPE.ATTACHMENT,
				id: attachment.id,
				name: attachment.name,
				url: attachment.url,
				width: attachment.width,
				height: attachment.height
			})
		}

		// users, guilds, stickers, and emojis are all downloaded below during processing
	}
} as EventHandler;

/** Breaks code guidelines using undefined but matches call signature for clearTimeout() */
let timeout: NodeJS.Timeout | undefined;
let messageQueue: Message<true>[] = [];
function QueueMessageForProcessing(message: Message<true>) {
	messageQueue.push(message);

	if (!timeout) {
		timeout = setTimeout(ProcessMessages, process.env.DEV_MODE ? 5000 : SECONDS.MINUTE * 10 * 1000) // 5 seconds if dev mode, 10 minutes otherwise
	}
}

export type ProcessOptions = {
	/** Disables final log with timing */
	quiet?: boolean;
}

export async function ProcessMessages(opts: ProcessOptions = {}): Promise<void> {
	timeout = undefined;

	// clone the original queue, breaking reference
	const messages: Message<true>[] = messageQueue.slice();
	messageQueue = []; // reset length

	const guilds      = new Map<  Guild['id'], Guild            >();
	const channels    = new Map<Channel['id'], GuildBasedChannel>();
	const users       = new Map<   User['id'], User             >();
	const stickers    = new Map<Sticker['id'], Sticker          >();
	const emojis      = new Map<  Emoji['id'], SimpleEmoji      >();
	const messageData = new Array<Omit<SimpleMessage, 'encryption_version'>>(messages.length);

	for (let i = messages.length - 1; i >= 0; i--) { // reverse loop to get the most recent data first
		const message = messages[i];
		if (!guilds.has(message.guild.id)) guilds.set(message.guild.id, message.guild);
		if (!channels.has(message.channel.id)) channels.set(message.channel.id, message.channel);
		if (!users.has(message.author.id)) users.set(message.author.id, message.author);

		const sticker = message.stickers.first() ?? null;
		if (sticker && !stickers.has(sticker.id)) stickers.set(sticker.id, sticker);

		const emojiIDs: string[] = [];
		const messageEmojis = message.content.match(/<(a?):(\w+):(\d+)>/g);
		for (const emoji of messageEmojis ?? []) {
			const [animated, name, id] = emoji.slice(1, -1).split(':');
			if (!emojis.has(id)) emojis.set(id, { id: BigInt(id), name, animated: animated === 'a' ? 1 : 0 });
			emojiIDs.push(id);
		}

		messageData[i] = {
			id: BigInt(message.id),
			guild_id: BigInt(message.guild.id),
			channel_id: BigInt(message.channel.id),
			user_id: BigInt(message.author.id),

			content: Buffer.from(message.content),

			sticker_id: sticker ? BigInt(sticker.id) : null,

			reply_to: message.reference && message.reference.messageId ? BigInt(message.reference.messageId) : null,

			length: message.content.length,

			created_at: message.createdAt,

			data: {
				attachments: Array.from(message.attachments.values()).map( x => ({ id: x.id, name: x.name })),
				emoji_ids: emojiIDs,
				embeds: message.embeds.map(x => x.toJSON()).filter(
					// ignore embeds from gif links
					x => !x.url?.startsWith("https:\/\/tenor\.com\/view\/")
				),
				components: message.components.map(x => x.toJSON())
			}
		}
	}

	for (const guild of guilds.values()) {
		if (guild.icon) QueueDownload({
			type: ASSET_TYPE.GUILD,
			id: guild.id!,
			name: guild.name,
			url: guild.iconURL({ size: 256 })!,
			width: 256,
			height: 256
		})
	}

	for (const user of users.values()) {
		if (user.avatar) QueueDownload({
			type: ASSET_TYPE.USER,
			id: user.id,
			name: user.username,
			url: user.avatarURL({ size: 256 })!,
			width: 256,
			height: 256
		})
	}

	for (const sticker of stickers.values()) {
		QueueDownload({
			type: ASSET_TYPE.STICKER,
			id: sticker.id,
			name: sticker.name,
			url: sticker.url,
			width: 256,
			height: 256
		})
	}

	for (const emoji of emojis.values()) {
		QueueDownload({
			type: ASSET_TYPE.EMOJI,
			id: String(emoji.id),
			name: emoji.name,
			url: `https://cdn.discordapp.com/emojis/${emoji.id}`,
			width: 48,
			height: 48
		})
	}

	const connection = await Database.getConnection();

	await connection.query('BEGIN');

	try {

		const promises: Promise<unknown>[] = [];

		promises.push( BulkInsert( connection,
			`INSERT INTO Guilds (id, name, features) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE name = VALUES(name)`,
			Array.from(guilds.values()).map( x => [
				BigInt(x.id), x.name, Object.values(GUILD_FEATURES).reduce((a, b) => a | b, 0),
			])
		));
		promises.push( BulkInsert( connection,
			`INSERT INTO Channels (id, guild_id, name, type) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE name = VALUES(name)`,
			Array.from(channels.values()).map( x => [
				BigInt(x.id), BigInt(x.guildId), x.name, x.type
			])
		));
		promises.push( BulkInsert( connection,
			`INSERT INTO Users (id, username, bot) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE username = VALUES(username)`,
			Array.from(users.values()).map( x => [
				BigInt(x.id), x.username, x.bot
			])
		));
		promises.push( BulkInsert( connection,
			`INSERT INTO Stickers (id, name) VALUES (?, ?) ON DUPLICATE KEY UPDATE name = VALUES(name)`,
			Array.from(stickers.values()).map( x => [
				BigInt(x.id), x.name
			])
		));
		promises.push( BulkInsert(connection,
			`INSERT INTO Emojis (id, name, animated) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE name = VALUES(name)`,
			Array.from(emojis.values()).map( x => [
				x.id, x.name, x.animated
			])
		));

		await Promise.all(promises);

		await BulkInsert( connection,
			`INSERT INTO Messages (
                      id, guild_id, channel_id, user_id,
                      content, length, sticker_id,
                      reply_to,
                      data
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			messageData.map( x => [
				x.id, x.guild_id, x.channel_id, x.user_id,
				x.content, x.content?.length, x.sticker_id,
				x.reply_to,
				JSON.stringify(x.data, JSONReplacer)
			])
		);

		await connection.query('COMMIT');
	} catch (error) {
		Log('ERROR', error);
		await connection.query('ROLLBACK');
	} finally {
		Database.releaseConnection(connection);
	}

	if (!opts.quiet) Log('TRACE', `Inserted ${messageData.length} messages :D`);
}

async function BulkInsert(connection: PoolConnection, sql: string, rows: unknown[][]) {
	const promises: Promise<unknown>[] = [];
	if (rows.length === 0) return promises; // nothing to save!

	if (rows.length < 3) {
		for (const row of rows) {
			promises.push( connection.query(sql, row) );
		}
	} else {
		const statement = await connection.prepare(sql);
		for (const row of rows) {
			promises.push(statement.execute(row));
		}
		statement.close();
	}

	return promises;
}