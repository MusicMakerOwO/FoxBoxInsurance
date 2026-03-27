import * as dotenv from "dotenv";
import { afterAll, assert, describe, expect, it } from "vitest";
import { Database } from "../Database";
import { ExportChannel, JSONExport } from "../Utils/Parsers/Export";
import { FORMAT } from "../Utils/Constants";
import {
	SimpleChannel,
	SimpleEmoji,
	SimpleGuild,
	SimpleMessage,
	SimpleSticker,
	SimpleUser
} from "../Typings/DatabaseTypes";
import { APIEmbed, APIMessageTopLevelComponent } from "discord-api-types/v10";
import { EmbedType } from "discord.js";

dotenv.config({ path: `${__dirname}/../../.env`, quiet: true });

function Pick<T extends object, K extends keyof T>(data: T, props: K[]): Pick<T, K> {
	const result = {} as Pick<T, K>;
	for (const key of props) {
		result[key] = data[key];
	}
	return result;
}

function BigIntToString<T>(data: T): T {
	if (typeof data === "bigint") {
		return data.toString() as unknown as T;
	}
	if (Array.isArray(data)) {
		return data.map(BigIntToString) as unknown as T;
	}
	if (data && typeof data === "object") {
		const result: any = {};
		for (const [key, value] of Object.entries(data)) {
			result[key] = BigIntToString(value);
		}
		return result;
	}
	return data;
}

const guild: SimpleGuild = {
	id          : 1n,
	name        : "Test Server",
	features    : 0,
	last_restore: 0n
}

const channel: SimpleChannel = {
	id           : 2n,
	guild_id     : guild.id,
	name         : 'general',
	type         : 0,
	block_exports: 0,
	last_purge   : 0
}

const user: SimpleUser = {
	id                    : 3n,
	username              : 'musicmaker',
	bot                   : 0,
	terms_version_accepted: 0,
	wrapped_key           : null,
	rotation_hour         : 0
}

const embed: APIEmbed = {
	title      : "Test Embed Title",
	type       : EmbedType.Rich, // always "rich" for webhook embeds
	description: "This is a test description for the embed.",
	url        : "https://example.com",
	timestamp  : new Date().toISOString(),
	color      : 0x00ff99, // green
	footer     : {
		text          : "Test Footer Text",
		icon_url      : "https://cdn.discordapp.com/embed/avatars/0.png",
		proxy_icon_url: "https://cdn.discordapp.com/embed/avatars/0.png"
	},
	image      : {
		url      : "https://cdn.discordapp.com/embed/avatars/1.png",
		proxy_url: "https://cdn.discordapp.com/embed/avatars/1.png",
		height   : 128,
		width    : 128
	},
	thumbnail  : {
		url      : "https://cdn.discordapp.com/embed/avatars/2.png",
		proxy_url: "https://cdn.discordapp.com/embed/avatars/2.png",
		height   : 64,
		width    : 64
	},
	video      : {
		url      : "https://cdn.discordapp.com/embed/avatars/3.png",
		proxy_url: "https://cdn.discordapp.com/embed/avatars/3.png",
		height   : 480,
		width    : 640
	},
	provider   : {
		name: "Test Provider",
		url : "https://provider.example.com"
	},
	author     : {
		name          : "Test Author",
		url           : "https://author.example.com",
		icon_url      : "https://cdn.discordapp.com/embed/avatars/4.png",
		proxy_icon_url: "https://cdn.discordapp.com/embed/avatars/4.png"
	},
	fields     : [
		{
			name  : "Field 1",
			value : "Some value for field 1",
			inline: false
		},
		{
			name  : "Field 2",
			value : "Some value for field 2",
			inline: false
		},
		{
			name  : "Field 3",
			value : "Some value for field 4",
			inline: true
		},
		{
			name  : "Field 4",
			value : "Some value for field 4",
			inline: true
		}
	]
}

const components: APIMessageTopLevelComponent = {
	type      : 1,
	components: [
		{
			type     : 2,
			style    : 3,
			custom_id: 'create_some-random_args_1234567890_1234567890',
			label    : 'Create',
			emoji    : { name: '✅' },
			disabled : true
		},
		{
			type     : 2,
			style    : 4,
			custom_id: 'delete_some-random_args_1234567890_1234567890',
			label    : 'Delete',
			emoji    : { name: '🗑️' },
			disabled : false
		}
	]
}

const emojis: SimpleEmoji[] = [
	{
		"id"      : 1337n,
		"name"    : "kekw",
		"animated": 0
	},
	{
		"id"      : 2026n,
		"name"    : "partyblob",
		"animated": 1
	},
	{
		"id"      : 4821n,
		"name"    : "smolcat",
		"animated": 0
	},
	{
		"id"      : 9182n,
		"name"    : "hyperwave",
		"animated": 1
	},
	{
		"id"      : 5555n,
		"name"    : "shrugger",
		"animated": 0
	},
	{
		"id"      : 7777n,
		"name"    : "blobdance",
		"animated": 1
	}
]

const sticker: SimpleSticker = {
	"id"  : 6767n,
	"name": "no thoughts"
}

const messages = new Array<SimpleMessage>(10_000 + 1);
for (let i = 0; i < 10_000 + 1; i++) {
	messages[i] = {
		id                : BigInt(i),
		guild_id          : guild.id,
		channel_id        : channel.id,
		user_id           : user.id,
		content           : Buffer.from('a'),
		length            : 1,
		sticker_id        : sticker.id,
		reply_to          : null,
		created_at        : new Date(),
		encryption_version: null,
		data              : {
			embeds     : [],
			attachments: [],
			emoji_ids  : [],
			components : []
		}
	}
}

messages[1] = {
	id                : 1n,
	guild_id          : guild.id,
	channel_id        : channel.id,
	user_id           : user.id,
	content           : Buffer.from('Hello, World!'),
	length            : 1,
	sticker_id        : sticker.id,
	reply_to          : null,
	created_at        : new Date(),
	encryption_version: null,
	data              : {
		embeds     : [embed],
		attachments: [],
		emoji_ids  : emojis.map(x => x.id.toString()),
		components : [components]
	}
}

describe("ExportMessages", async () => {

	const connection = await Database.getConnection();

	await connection.query(`
        INSERT INTO Guilds (id, name, features)
        VALUES (?, ?, ?)
	`, [guild.id, guild.name, guild.features]);
	await connection.query(`
        INSERT INTO Channels (id, name, type, guild_id)
        VALUES (?, ?, ?, ?)
	`, [channel.id, channel.name, channel.type, channel.guild_id]);
	await connection.query(`
        INSERT INTO Users (id, username, bot)
        VALUES (?, ?, ?)
	`, [user.id, user.username, user.bot]);

	const promises: Promise<unknown>[] = [];

	for (const emoji of emojis) {
		promises.push(
			connection.query(`
                INSERT INTO Emojis (id, name, animated)
                VALUES (?, ?, ?)
			`, [
				emoji.id, emoji.name, emoji.animated
			])
		)
	}

	promises.push(
		connection.query(`
            INSERT INTO Stickers (id, name)
            VALUES (?, ?)
		`, [
			sticker.id, sticker.name
		])
	)

	promises.push(
		connection.batch(`
            INSERT INTO Messages (id, guild_id, channel_id, user_id, content, sticker_id, reply_to, length, data)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
		`, messages.map(msg => [
			msg.id, msg.guild_id, msg.channel_id, msg.user_id, msg.content, msg.sticker_id, msg.reply_to, msg.length, msg.data
		]))
	)

	await Promise.all(promises);

	// Using JSON because it is the easiest to test since it is just a raw dump of the export context
	// This should allow for easy testing of included data, format, and no parsing required
	// The other formats will only be tested to not error but manual testing will be required
	const channelExport = await ExportChannel({
		guildID     : guild.id,
		channelID   : channel.id,
		userID      : user.id,
		messageCount: 10_000,
		format      : FORMAT.JSON
	});

	const fileData = JSON.parse(channelExport.data.toString()) as JSONExport;
	const exportID = channelExport.id;

	it('should not export more than 10,000 messages', async () => {
		await expect(async () => {
			await ExportChannel({
				guildID     : guild.id,
				channelID   : channel.id,
				userID      : user.id,
				messageCount: 10_000 + 1,
				format      : FORMAT.JSON
			})
		})
		.rejects
		.toThrow('Cannot export more than 10,000 messages');
	});
	it('should not export 0 messages', async () => {
		await expect(async () => {
			await ExportChannel({
				guildID     : guild.id,
				channelID   : channel.id,
				userID      : user.id,
				messageCount: 0,
				format      : FORMAT.JSON
			})
		})
		.rejects
		.toThrow('Cannot export 0 messages');
		await expect(async () => {
			await ExportChannel({
				guildID     : guild.id,
				channelID   : channel.id,
				userID      : user.id,
				messageCount: -1,
				format      : FORMAT.JSON
			})
		})
		.rejects
		.toThrow('Cannot export 0 messages');
	});

	it('should export a text format without error', async () => {
		try {
			await ExportChannel({
				guildID     : guild.id,
				channelID   : channel.id,
				userID      : user.id,
				messageCount: 1,
				format      : FORMAT.TEXT
			});
		} catch (error) {
			assert.fail((error as Error).message);
		}
	});
	it('should export ax HTML format without error', async () => {
		try {
			await ExportChannel({
				guildID     : guild.id,
				channelID   : channel.id,
				userID      : user.id,
				messageCount: 1,
				format      : FORMAT.HTML
			});
		} catch (error) {
			assert.fail((error as Error).message);
		}
	});

	it('should contain all the required metadata and warnings', () => {
		expect(fileData.export)
		.toEqual({
			owner  : `@${user.username} (${user.id})`,
			guild  : `${guild.name} (${guild.id})`,
			channel: `#${channel.name} (${channel.id})`,
			id     : exportID,
			warning: `
This export has been generated by FBI : https://www.notfbi.dev/invite
You can check if the export has been tampered with by using /verify and the ID above`.trim()
		})
	});

	it('should the guild info', () => {
		expect(fileData.guild)
		.toEqual(BigIntToString(Pick(guild, ['id', 'name'])))
	});
	it('should the channel info', () => {
		expect(fileData.channel)
		.toEqual(BigIntToString(Pick(channel, ['id', 'name', 'type'])))
	});

	it('should only contain relevant users', () => {
		expect(Object.keys(fileData.users).length)
		.toBe(1);
	});
	it('should only export public data for users', () => {
		expect(fileData.users[user.id.toString()])
		.toEqual(
			BigIntToString(
				Pick(user, ['id', 'username', 'bot'])
			)
		)
	});

	it('should only contain relevant emojis', () => {
		expect(Object.keys(fileData.emojis).length)
		.toBe(emojis.length);
	});
	it('should only export public data for emojis', () => {
		for (const emoji of emojis) {
			expect(fileData.emojis[emoji.id.toString()])
			.toEqual(
				BigIntToString(
					Pick(emoji, ['id', 'name', 'animated'])
				)
			)
		}
	});

	it('should only contain relevant stickers', () => {
		expect(Object.keys(fileData.stickers).length)
		.toBe(1);
	});
	it('should only export public data for sticker', () => {
		expect(fileData.stickers[sticker.id.toString()])
		.toEqual(
			BigIntToString(
				Pick(sticker, ['id', 'name'])
			)
		)
	});

	it('should contain message IDs in ascending order', () => {
		expect(fileData.messages[0].id)
		.toBe(messages[1].id.toString());
		expect(fileData.messages[9_999].id)
		.toBe(messages[10_000].id.toString());
	});

	it('should contain the original message data minus private data', () => {
		expect(fileData.messages[0])
		.toEqual(
			BigIntToString(
				{
					... Pick(messages[1], ["id", "user_id", "content", "sticker_id", "reply_to", "data", "created_at"]),
					content: messages[1].content!.toString(),
					// the bit shifts performed internally kind of fuck with my
					// made up message IDs so dates are always invalid
					created_at: "2015-01-01T00:00:00.000Z"
				}
			)
		)
	});

	afterAll(async () => {
		await connection.query(`
            DELETE
            FROM Messages
            WHERE id <= 10000
		`);
		await connection.query(`
            DELETE
            FROM Channels
            WHERE id = ?
		`, [channel.id]);
		await connection.query(`
            DELETE
            FROM Users
            WHERE id = ?
		`, [user.id]);
		await connection.query(`
            DELETE
            FROM Guilds
            WHERE id = ?
		`, [guild.id]);
		await connection.query(`
            DELETE
            FROM Stickers
            WHERE id = ?
		`, [sticker.id]);
		await connection.query(`
            DELETE
            FROM Emojis
            WHERE id IN (${new Array(emojis.length).fill('?')
            .join(',')})
		`, emojis.map(x => x.id));
		Database.releaseConnection(connection);
		await Database.destroy();
	});
})