import * as dotenv from "dotenv";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { client } from "../Client";
import {
	APIChannel, APIEmoji, APIGuild, APIMessage, APISticker, APIUser, Guild, TextChannel, Message,
	MessageFlags, EmbedType, APIAttachment
} from "discord.js";
import { MessageCreate } from "../Events";
import { ProcessMessages } from "../Events/Messages";
import { Database } from "../Database";
import {
	GUILD_FEATURES,
	SimpleChannel,
	SimpleEmoji,
	SimpleGuild,
	SimpleMessage, SimpleSticker,
	SimpleUser
} from "../Typings/DatabaseTypes";
import { APIEmbed, APIMessageTopLevelComponent } from "discord-api-types/v10";

dotenv.config({ path: `${__dirname}/../../.env`, quiet: true });

const API_ATTACHMENT: APIAttachment = {
	id      : '123',
	filename: 'robots.txt',
	// Normally a discord cdn url but technically any would work lol
	url      : 'https://notfbi.dev/robots.txt',
	proxy_url: 'https://notfbi.dev/robots.txt',
	size     : 0 // file size in bytes, means literally nothing though
}

const API_USER = {
	username              : 'unknown',
	public_flags          : 128,
	primary_guild         : null,
	id                    : '1234567890',
	global_name           : 'Test User',
	display_name_styles   : null,
	discriminator         : '0',
	collectibles          : null,
	clan                  : null,
	avatar_decoration_data: null,
	avatar                : '71223fc945b9daca491d6aea0a710c60'
} as unknown as APIUser;

const API_EMOJIS: APIEmoji[] = [
	{
		"id"            : "1337",
		"name"          : "kekw",
		"roles"         : [],
		"require_colons": true,
		"managed"       : false,
		"animated"      : false,
		"available"     : true
	},
	{
		"id"            : "2026",
		"name"          : "partyblob",
		"roles"         : [],
		"require_colons": true,
		"managed"       : false,
		"animated"      : true,
		"available"     : true
	},
	{
		"id"            : "4821",
		"name"          : "smolcat",
		"roles"         : [],
		"require_colons": true,
		"managed"       : false,
		"animated"      : false,
		"available"     : true
	},
	{
		"id"            : "9182",
		"name"          : "hyperwave",
		"roles"         : [],
		"require_colons": true,
		"managed"       : false,
		"animated"      : true,
		"available"     : true
	},
	{
		"id"            : "5555",
		"name"          : "shrugger",
		"roles"         : [],
		"require_colons": true,
		"managed"       : false,
		"animated"      : false,
		"available"     : true
	},
	{
		"id"            : "7777",
		"name"          : "blobdance",
		"roles"         : [],
		"require_colons": true,
		"managed"       : false,
		"animated"      : true,
		"available"     : true
	}
]

const API_STICKER = {
	"id"         : "6767",
	"name"       : "no thoughts",
	"tags"       : "fox",
	"type"       : 2,
	"format_type": 1,
	"description": "",
	"asset"      : "",
	"available"  : true,
	"guild_id"   : "1"
} as unknown as APISticker;

const API_GUILD = {
	"id"                                          : "1",
	"name"                                        : "Test Server",
	"icon"                                        : "46bcf5ecf5c06f1bb473456e2471e705",
	"description"                                 : null,
	"home_header"                                 : null,
	"splash"                                      : null,
	"discovery_splash"                            : null,
	"features"                                    : ["NEWS", "TEXT_IN_VOICE_ENABLED", "COMMUNITY", "CHANNEL_ICON_EMOJIS_GENERATED"],
	"banner"                                      : null,
	"owner_id"                                    : "556949122003894296",
	"application_id"                              : null,
	"region"                                      : "us-south",
	"afk_channel_id"                              : null,
	"afk_timeout"                                 : 300,
	"system_channel_id"                           : "618177757356228659",
	"system_channel_flags"                        : 4,
	"widget_enabled"                              : false,
	"widget_channel_id"                           : null,
	"verification_level"                          : 1,
	"roles"                                       : [],
	"default_message_notifications"               : 1,
	"mfa_level"                                   : 0,
	"explicit_content_filter"                     : 2,
	"max_presences"                               : null,
	"max_members"                                 : 25000000,
	"max_stage_video_channel_users"               : 50,
	"max_video_channel_users"                     : 25,
	"vanity_url_code"                             : null,
	"premium_tier"                                : 0,
	"premium_subscription_count"                  : 0,
	"preferred_locale"                            : "en-US",
	"rules_channel_id"                            : "948331690042982410",
	"safety_alerts_channel_id"                    : null,
	"public_updates_channel_id"                   : "948331690042982410",
	"hub_type"                                    : null,
	"premium_progress_bar_enabled"                : false,
	"premium_progress_bar_enabled_user_updated_at": null,
	"latest_onboarding_question_id"               : null,
	"nsfw"                                        : false,
	"nsfw_level"                                  : 0,
	"owner_configured_content_level"              : 0,
	"emojis"                                      : [],
	"stickers"                                    : [],
	"incidents_data"                              : null,
	"inventory_settings"                          : null,
	"embed_enabled"                               : false,
	"embed_channel_id"                            : null
} as unknown as APIGuild;

const API_CHANNEL = {
	"id"                   : "3",
	"type"                 : 0,
	"last_message_id"      : "1484274502815846461",
	"flags"                : 0,
	"last_pin_timestamp"   : "2025-12-11T16:58:57.066000+00:00",
	"guild_id"             : API_GUILD.id,
	"name"                 : "miscellaneous",
	"parent_id"            : null,
	"rate_limit_per_user"  : 0,
	"topic"                : null,
	"position"             : 0,
	"permission_overwrites": [],
	"nsfw"                 : false,
	"icon_emoji"           : { "id": null, "name": "\ud83c\udfb2" },
	"theme_color"          : null
} as unknown as APIChannel;

const API_MESSAGE_EMPTY = {
	type            : 0,
	tts             : false,
	timestamp       : '2026-03-19T19:36:57.958000+00:00',
	pinned          : false,
	nonce           : '1484274502203342848',
	mentions        : [],
	mention_roles   : [],
	mention_everyone: false,
	member          : null,
	id              : '1234',
	flags           : 0,
	embeds          : [],
	edited_timestamp: null,
	content         : '',
	components      : [],
	channel_type    : 0,
	channel_id      : API_CHANNEL.id,
	author          : API_USER,
	attachments     : [],
	guild_id        : API_GUILD.id,
	stickers        : []
} as unknown as APIMessage;

const INSERTED_MESSAGE_EMPTY = {
	id                : 1234n,
	guild_id          : 1n,
	channel_id        : 3n,
	user_id           : 1234567890n,
	content           : null,
	sticker_id        : null,
	reply_to          : null,
	encryption_version: null,
	data              : { attachments: [], emoji_ids: [], embeds: [], components: [] },
	length            : 0,
	created_at        : new Date('2015-01-01T00:00:00.000Z')
} as SimpleMessage;

// @ts-expect-error | Dummy user to fake being logged in
client.user = {
	id: '1089343117142020319'
}

async function ClearTestData() {
	await Database.query('DELETE FROM Messages WHERE id = ?', [BigInt(API_MESSAGE_EMPTY.id)]);
	await Database.query('DELETE FROM Channels WHERE id = ?', [BigInt(API_CHANNEL.id)]);
	await Database.query('DELETE FROM Users WHERE id = ?', [BigInt(API_USER.id)]);
	await Database.query('DELETE FROM Guilds WHERE id = ?', [BigInt(API_GUILD.id)]);
	await Database.query(`
        DELETE
        FROM Emojis
        WHERE id IN (${new Array(API_EMOJIS.length).fill('?')
        .join(',')})
	`, API_EMOJIS.map(x => BigInt(x.id!)))
	await Database.query('DELETE FROM Stickers WHERE id = ?', [BigInt(API_STICKER.id)]);
}

describe("SaveMessages", () => {
	beforeEach(async () => {
		client.guilds.cache.clear();
		client.channels.cache.clear();

		// @ts-expect-error | Constructors are private for some reason
		const TestGuild = new Guild(client, API_GUILD);
		// @ts-expect-error
		const TestChannel = new TextChannel(TestGuild, API_CHANNEL, client);

		client.guilds.cache.set(API_GUILD.id, TestGuild);
		client.channels.cache.set(API_CHANNEL.id, TestChannel);

		await ClearTestData();
	});

	it('saves an empty message', async () => {
		// @ts-expect-error
		await MessageCreate.execute(new Message<true>(client, API_MESSAGE_EMPTY));
		await ProcessMessages({ quiet: true });

		const savedMessage = await Database.query('SELECT * FROM Messages WHERE id = ?', [API_MESSAGE_EMPTY.id])
		.then(x => x[0]) as SimpleMessage;
		expect(savedMessage)
		.toEqual(INSERTED_MESSAGE_EMPTY);

		const savedGuild = await Database.query('SELECT * FROM Guilds WHERE id = ?', [API_GUILD.id])
		.then(x => x[0]) as SimpleGuild;
		expect(savedGuild)
		.toEqual({
			id          : BigInt(API_GUILD.id),
			name        : API_GUILD.name,
			features    : Object.values(GUILD_FEATURES)
			.reduce((acc, y) => acc | y, 0),
			last_restore: 0n
		});

		const savedChannel = await Database.query('SELECT * FROM Channels WHERE id = ?', [API_CHANNEL.id])
		.then(x => x[0]) as SimpleChannel;
		expect(savedChannel)
		.toEqual({
			id           : BigInt(API_CHANNEL.id),
			guild_id     : BigInt(API_GUILD.id),
			name         : API_CHANNEL.name,
			type         : API_CHANNEL.type,
			block_exports: 0,
			last_purge   : ~~(Date.now() / 1000) // unix epoch
		});

		const savedUser = await Database.query('SELECT * FROM Users WHERE id = ?', [API_USER.id])
		.then(x => x[0]) as SimpleUser;
		expect(savedUser)
		.toEqual({
			id                    : BigInt(API_USER.id),
			username              : API_USER.username,
			bot                   : +!!API_USER.bot,
			terms_version_accepted: 0,
			wrapped_key           : null,
			rotation_hour         : 18
		});
	});

	it('saves messages sent from the client', async () => {
		// @ts-expect-error
		await MessageCreate.execute(new Message<true>(client, {
			... API_MESSAGE_EMPTY,
			author: { ... API_MESSAGE_EMPTY.author, id: client.user.id, username: 'Fox Box Insurance', bot: true }
		}));
		await ProcessMessages({ quiet: true });

		const savedMessage = await Database.query('SELECT * FROM Messages WHERE id = ?', [API_MESSAGE_EMPTY.id])
		.then(x => x[0]) as SimpleMessage;
		expect(savedMessage)
		.toEqual({ ... INSERTED_MESSAGE_EMPTY, user_id: BigInt(client.user.id) });
	});

	it('ignores messages sent from the client that are ephemeral (hidden)', async () => {
		// @ts-expect-error
		await MessageCreate.execute(new Message<true>(client, {
			... API_MESSAGE_EMPTY,
			flags : MessageFlags.Ephemeral,
			author: { ... API_MESSAGE_EMPTY.author, id: client.user.id, username: 'Fox Box Insurance', bot: true }
		}));
		await ProcessMessages({ quiet: true });

		const savedMessage = await Database.query('SELECT * FROM Messages WHERE id = ?', [API_MESSAGE_EMPTY.id])
		.then(x => x[0]) as SimpleMessage;
		expect(savedMessage)
		.toEqual(undefined);
	});

	it('saves message content with no emojis', async () => {
		const text = 'Hello, World!';

		// @ts-expect-error
		await MessageCreate.execute(new Message<true>(client, { ... API_MESSAGE_EMPTY, content: text }));
		await ProcessMessages({ quiet: true });

		const savedMessage = await Database.query('SELECT * FROM Messages WHERE id = ?', [API_MESSAGE_EMPTY.id])
		.then(x => x[0]) as SimpleMessage;
		expect(savedMessage)
		.toEqual({ ... INSERTED_MESSAGE_EMPTY, length: text.length, content: Buffer.from(text) });
	});

	it('saves message content with only default emojis', async () => {
		const text = '😀😃😄😁';

		// @ts-expect-error
		await MessageCreate.execute(new Message<true>(client, { ... API_MESSAGE_EMPTY, content: text }));
		await ProcessMessages({ quiet: true });

		const savedMessage = await Database.query('SELECT * FROM Messages WHERE id = ?', [API_MESSAGE_EMPTY.id])
		.then(x => x[0]) as SimpleMessage;
		expect(savedMessage)
		.toEqual({ ... INSERTED_MESSAGE_EMPTY, length: text.length, content: Buffer.from(text) });
	});

	it('saves message content with only discord emojis', async () => {
		const text = API_EMOJIS.map(x => '<' + (x.animated ? 'a' : '') + ':' + (x.name) + ':' + (x.id) + '>')
		.join('');

		// @ts-expect-error
		await MessageCreate.execute(new Message<true>(client, { ... API_MESSAGE_EMPTY, content: text }));
		await ProcessMessages({ quiet: true });

		const savedMessage = await Database.query('SELECT * FROM Messages WHERE id = ?', [API_MESSAGE_EMPTY.id])
		.then(x => x[0]) as SimpleMessage;
		expect(savedMessage)
		.toEqual({
			... INSERTED_MESSAGE_EMPTY,
			data   : { ... INSERTED_MESSAGE_EMPTY.data, emoji_ids: API_EMOJIS.map(emoji => emoji.id) },
			length : Buffer.from(text, 'utf8').length,
			content: Buffer.from(text)
		});

		for (const emoji of API_EMOJIS) {
			const savedEmoji = await Database.query('SELECT * FROM Emojis WHERE id = ?', [BigInt(emoji.id!)])
			.then(x => x[0]) as SimpleEmoji;
			expect(savedEmoji)
			.toEqual({ id: BigInt(emoji.id!), name: emoji.name, animated: +!!emoji.animated });
		}
	});

	it('saves the sticker attached to a message', async () => {
		// @ts-expect-error
		await MessageCreate.execute(new Message<true>(client, { ... API_MESSAGE_EMPTY, stickers: [API_STICKER] }));
		await ProcessMessages({ quiet: true });

		const savedMessage = await Database.query('SELECT * FROM Messages WHERE id = ?', [API_MESSAGE_EMPTY.id])
		.then(x => x[0]) as SimpleMessage;
		expect(savedMessage)
		.toEqual({ ... INSERTED_MESSAGE_EMPTY, sticker_id: BigInt(API_STICKER.id) });

		const savedSticker = await Database.query('SELECT * FROM Stickers WHERE id = ?', [API_STICKER.id])
		.then(x => x[0]) as SimpleSticker;
		expect(savedSticker)
		.toEqual({
			id  : BigInt(API_STICKER.id),
			name: API_STICKER.name
		});
	});

	it('saves the full embed on a message', async () => {
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

		// @ts-expect-error
		await MessageCreate.execute(new Message<true>(client, { ... API_MESSAGE_EMPTY, embeds: [embed] }));
		await ProcessMessages({ quiet: true });

		const savedMessage = await Database.query('SELECT * FROM Messages WHERE id = ?', [API_MESSAGE_EMPTY.id])
		.then(x => x[0]) as SimpleMessage;
		expect(savedMessage)
		.toEqual({ ... INSERTED_MESSAGE_EMPTY, data: { ... INSERTED_MESSAGE_EMPTY.data, embeds: [embed] } });
	});

	it('saves all the components in a message', async () => {
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

		// @ts-expect-error
		await MessageCreate.execute(new Message<true>(client, { ... API_MESSAGE_EMPTY, components: [components] }));
		await ProcessMessages({ quiet: true });

		const savedMessage = await Database.query('SELECT * FROM Messages WHERE id = ?', [API_MESSAGE_EMPTY.id])
		.then(x => x[0]) as SimpleMessage;
		expect(savedMessage)
		.toEqual({ ... INSERTED_MESSAGE_EMPTY, data: { ... INSERTED_MESSAGE_EMPTY.data, components: [components] } });
	});

	it('saves attachments included in the message', async () => {
		// @ts-expect-error
		await MessageCreate.execute(new Message<true>(client, {
			... API_MESSAGE_EMPTY,
			attachments: [API_ATTACHMENT]
		}));
		await ProcessMessages({ quiet: true });

		const savedMessage = await Database.query('SELECT * FROM Messages WHERE id = ?', [API_MESSAGE_EMPTY.id])
		.then(x => x[0]) as SimpleMessage;
		expect(savedMessage)
		.toEqual({
			... INSERTED_MESSAGE_EMPTY,
			data: {
				... INSERTED_MESSAGE_EMPTY.data,
				attachments: [{ id: API_ATTACHMENT.id, name: API_ATTACHMENT.filename }]
			}
		});
	});

	afterAll(async () => {
		await ClearTestData();
		await Database.destroy();
	});
})