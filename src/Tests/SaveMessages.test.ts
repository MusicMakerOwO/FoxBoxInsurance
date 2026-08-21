import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Message, MessageFlags } from 'discord.js';
import { GUILD_FEATURES, SimpleGuild, SimpleUser } from '../Typings/DatabaseTypes.js';

const { GetGuild } = vi.hoisted(() => ({ GetGuild: vi.fn() }));
vi.mock('../CRUD/Guilds.js', () => ({ GetGuild }));

const { GetUser } = vi.hoisted(() => ({ GetUser: vi.fn() }));
vi.mock('../CRUD/Users.js', () => ({ GetUser }));

const { QueueDownload } = vi.hoisted(() => ({ QueueDownload: vi.fn() }));
vi.mock('../Utils/Processing/Images.js', () => ({
	QueueDownload,
	ASSET_TYPE: { GUILD: 0, USER: 1, EMOJI: 2, STICKER: 3, ATTACHMENT: 4 }
}));

const { getConnection, releaseConnection } = vi.hoisted(() => ({
	getConnection: vi.fn(),
	releaseConnection: vi.fn()
}));
vi.mock('../Database.js', () => ({ Database: { getConnection, releaseConnection } }));

import MessageCreateHandler, { ProcessMessages } from '../Events/Messages.js';

type Call = { sql: string, params: unknown[] };

function makeConnection() {
	const calls: Call[] = [];
	const query = vi.fn(async (sql: string, params: unknown[] = []) => {
		calls.push({ sql, params });
		return { affectedRows: 0n, insertId: 0n, warningStatus: 0 };
	});
	const prepare = vi.fn(async (sql: string) => ({
		execute: vi.fn(async (params: unknown[]) => {
			calls.push({ sql, params });
			return { affectedRows: 0n };
		}),
		close: vi.fn()
	}));
	return { query, prepare, calls };
}

function findInserts(calls: Call[], table: string) {
	return calls.filter(c => c.sql.includes(`INSERT INTO ${table}`));
}

function makeGuild(features: number, id = '900000000000000001'): SimpleGuild {
	return { id: BigInt(id), name: 'Test Guild', features, last_restore: 0n };
}

function makeUser(overrides: Partial<SimpleUser> = {}): SimpleUser {
	return {
		id: 900000000000000003n,
		username: 'tester',
		bot: 0,
		terms_version_accepted: 0,
		wrapped_key: null,
		rotation_hour: 0,
		opt_out_collection: 0,
		...overrides
	};
}

type FakeMessageOptions = {
	id?: string;
	guildId?: string;
	channelId?: string;
	authorBot?: boolean;
	content?: string;
	ephemeral?: boolean;
	sticker?: { id: string, name: string, url: string } | null;
	embeds?: Record<string, unknown>[];
	components?: Record<string, unknown>[];
	attachments?: { id: string, name: string, url: string, width: number | null, height: number | null }[];
};

function makeMessage(opts: FakeMessageOptions = {}): Message<true> {
	const guildId = opts.guildId ?? '900000000000000001';
	const channelId = opts.channelId ?? '900000000000000002';
	const authorId = '900000000000000003';
	const attachments = opts.attachments ?? [];

	return {
		guild: { id: guildId, icon: null },
		guildId,
		channel: { id: channelId, guildId, name: 'general', type: 0 },
		author: { id: authorId, username: 'tester', bot: opts.authorBot ?? false, avatar: null },
		flags: { has: (flag: number) => opts.ephemeral === true && flag === MessageFlags.Ephemeral },
		stickers: { first: () => opts.sticker ? { ...opts.sticker } : undefined },
		content: opts.content ?? '',
		attachments: { values: () => attachments.values() },
		embeds: (opts.embeds ?? []).map(e => ({ toJSON: () => e })),
		components: (opts.components ?? []).map(c => ({ toJSON: () => c })),
		reference: null,
		id: opts.id ?? '900000000000000009',
		createdTimestamp: 1700000000000,
		createdAt: new Date(1700000000000)
	} as unknown as Message<true>;
}

beforeEach(() => {
	vi.useFakeTimers(); // QueueMessageForProcessing schedules a real setTimeout we never let fire
	GetGuild.mockReset();
	GetUser.mockReset();
	QueueDownload.mockReset();
	getConnection.mockReset();
	releaseConnection.mockReset();
});

afterEach(() => {
	vi.useRealTimers();
});

describe('SaveMessages', () => {
	it('saves an empty message', async () => {
		const connection = makeConnection();
		GetGuild.mockResolvedValue(makeGuild(GUILD_FEATURES.MESSAGE_SAVING));
		GetUser.mockResolvedValue(makeUser());
		getConnection.mockResolvedValue(connection);

		await MessageCreateHandler.execute(makeMessage({ content: '' }));
		await ProcessMessages({ quiet: true });

		const insert = findInserts(connection.calls, 'Messages')[0];
		expect(insert).toBeDefined();
		expect(insert.params[4]).toBeNull(); // content
		expect(insert.params[5]).toBe(0); // length
	});

	it('saves messages sent from the client', async () => {
		const connection = makeConnection();
		GetGuild.mockResolvedValue(makeGuild(GUILD_FEATURES.MESSAGE_SAVING));
		GetUser.mockResolvedValue(makeUser());
		getConnection.mockResolvedValue(connection);

		await MessageCreateHandler.execute(makeMessage({ authorBot: true, content: 'I am a bot' }));
		await ProcessMessages({ quiet: true });

		expect(findInserts(connection.calls, 'Messages')).toHaveLength(1);
	});

	it('ignores messages sent from the client that are ephemeral (hidden)', async () => {
		const connection = makeConnection();
		GetGuild.mockResolvedValue(makeGuild(GUILD_FEATURES.MESSAGE_SAVING));
		GetUser.mockResolvedValue(makeUser());
		getConnection.mockResolvedValue(connection);

		await MessageCreateHandler.execute(makeMessage({ authorBot: true, ephemeral: true, content: 'hidden response' }));
		await ProcessMessages({ quiet: true });

		expect(findInserts(connection.calls, 'Messages')).toHaveLength(0);
	});

	it('saves message content with no emojis', async () => {
		const connection = makeConnection();
		GetGuild.mockResolvedValue(makeGuild(GUILD_FEATURES.MESSAGE_SAVING));
		GetUser.mockResolvedValue(makeUser());
		getConnection.mockResolvedValue(connection);

		await MessageCreateHandler.execute(makeMessage({ content: 'Hello world, no emojis here' }));
		await ProcessMessages({ quiet: true });

		const insert = findInserts(connection.calls, 'Messages')[0]!;
		const data = JSON.parse(insert.params[8] as string);
		expect(data.emoji_ids).toEqual([]);
	});

	it('saves message content with only default emojis', async () => {
		const connection = makeConnection();
		GetGuild.mockResolvedValue(makeGuild(GUILD_FEATURES.MESSAGE_SAVING));
		GetUser.mockResolvedValue(makeUser());
		getConnection.mockResolvedValue(connection);

		await MessageCreateHandler.execute(makeMessage({ content: 'Great job! \u{1F600}\u{1F389}' }));
		await ProcessMessages({ quiet: true });

		const insert = findInserts(connection.calls, 'Messages')[0]!;
		expect(insert.params[4]).toEqual(Buffer.from('Great job! \u{1F600}\u{1F389}', 'utf8'));
		const data = JSON.parse(insert.params[8] as string);
		expect(data.emoji_ids).toEqual([]);
	});

	it('saves message content with only discord emojis', async () => {
		const connection = makeConnection();
		GetGuild.mockResolvedValue(makeGuild(GUILD_FEATURES.MESSAGE_SAVING));
		GetUser.mockResolvedValue(makeUser());
		getConnection.mockResolvedValue(connection);

		await MessageCreateHandler.execute(makeMessage({ content: 'Check this out <:pepe:123456789012345678>' }));
		await ProcessMessages({ quiet: true });

		const insert = findInserts(connection.calls, 'Messages')[0]!;
		const data = JSON.parse(insert.params[8] as string);
		expect(data.emoji_ids).toEqual(['123456789012345678']);
	});

	it('saves the sticker attached to a message', async () => {
		const connection = makeConnection();
		GetGuild.mockResolvedValue(makeGuild(GUILD_FEATURES.MESSAGE_SAVING));
		GetUser.mockResolvedValue(makeUser());
		getConnection.mockResolvedValue(connection);

		await MessageCreateHandler.execute(makeMessage({
			sticker: { id: '999000000000000001', name: 'Cool Sticker', url: 'https://cdn.discordapp.com/stickers/999.png' }
		}));
		await ProcessMessages({ quiet: true });

		const insert = findInserts(connection.calls, 'Messages')[0]!;
		expect(insert.params[6]).toBe(999000000000000001n); // sticker_id

		const stickerInsert = findInserts(connection.calls, 'Stickers')[0];
		expect(stickerInsert).toBeDefined();
		expect(stickerInsert!.params).toEqual([999000000000000001n, 'Cool Sticker']);
	});

	it('saves the full embed on a message', async () => {
		const connection = makeConnection();
		GetGuild.mockResolvedValue(makeGuild(GUILD_FEATURES.MESSAGE_SAVING));
		GetUser.mockResolvedValue(makeUser());
		getConnection.mockResolvedValue(connection);

		const embed = { title: 'Full Embed', description: 'With everything', fields: [{ name: 'f1', value: 'v1' }] };
		await MessageCreateHandler.execute(makeMessage({ embeds: [embed] }));
		await ProcessMessages({ quiet: true });

		const insert = findInserts(connection.calls, 'Messages')[0]!;
		const data = JSON.parse(insert.params[8] as string);
		expect(data.embeds).toEqual([embed]);
	});

	it('saves all the components in a message', async () => {
		const connection = makeConnection();
		GetGuild.mockResolvedValue(makeGuild(GUILD_FEATURES.MESSAGE_SAVING));
		GetUser.mockResolvedValue(makeUser());
		getConnection.mockResolvedValue(connection);

		const component = { type: 1, components: [{ type: 2, label: 'Click me', style: 1 }] };
		await MessageCreateHandler.execute(makeMessage({ components: [component] }));
		await ProcessMessages({ quiet: true });

		const insert = findInserts(connection.calls, 'Messages')[0]!;
		const data = JSON.parse(insert.params[8] as string);
		expect(data.components).toEqual([component]);
	});

	it('saves attachments included in the message', async () => {
		const connection = makeConnection();
		GetGuild.mockResolvedValue(makeGuild(GUILD_FEATURES.MESSAGE_SAVING));
		GetUser.mockResolvedValue(makeUser());
		getConnection.mockResolvedValue(connection);

		const attachment = { id: '555000000000000001', name: 'image.png', url: 'https://cdn.discordapp.com/attachments/x/image.png', width: 100, height: 100 };
		await MessageCreateHandler.execute(makeMessage({ attachments: [attachment] }));
		await ProcessMessages({ quiet: true });

		const insert = findInserts(connection.calls, 'Messages')[0]!;
		const data = JSON.parse(insert.params[8] as string);
		expect(data.attachments).toEqual([{ id: '555000000000000001', name: 'image.png' }]);
	});

	it('redacts message data for users who opted out of collection', async () => {
		const connection = makeConnection();
		GetGuild.mockResolvedValue(makeGuild(GUILD_FEATURES.MESSAGE_SAVING));
		GetUser.mockResolvedValue(makeUser({ opt_out_collection: 1 }));
		getConnection.mockResolvedValue(connection);

		await MessageCreateHandler.execute(makeMessage({
			content: 'This should be redacted',
			sticker: { id: '999000000000000002', name: 'Sticker', url: 'https://x' },
			embeds: [{ title: 'x' }]
		}));
		await ProcessMessages({ quiet: true });

		const insert = findInserts(connection.calls, 'Messages')[0]!;
		expect(insert.params[4]).toBeNull(); // content
		expect(insert.params[5]).toBe(0); // length
		expect(insert.params[6]).toBeNull(); // sticker_id
		const data = JSON.parse(insert.params[8] as string);
		expect(data).toEqual({ attachments: [], emoji_ids: [], embeds: [], components: [] });
	});

	describe('MessageHistory', () => {
		it('saves message history for guilds with MESSAGE_HISTORY feature enabled', async () => {
			const connection = makeConnection();
			GetGuild.mockResolvedValue(makeGuild(GUILD_FEATURES.MESSAGE_SAVING | GUILD_FEATURES.MESSAGE_HISTORY));
			GetUser.mockResolvedValue(makeUser());
			getConnection.mockResolvedValue(connection);

			await MessageCreateHandler.execute(makeMessage({}));
			await ProcessMessages({ quiet: true });

			expect(findInserts(connection.calls, 'MessageHistory')).toHaveLength(1);
		});

		it('saves multiple message history entries for multiple messages', async () => {
			const connection = makeConnection();
			GetGuild.mockResolvedValue(makeGuild(GUILD_FEATURES.MESSAGE_SAVING | GUILD_FEATURES.MESSAGE_HISTORY));
			GetUser.mockResolvedValue(makeUser());
			getConnection.mockResolvedValue(connection);

			await MessageCreateHandler.execute(makeMessage({ id: '900000000000001001' }));
			await MessageCreateHandler.execute(makeMessage({ id: '900000000000001002' }));
			await ProcessMessages({ quiet: true });

			expect(findInserts(connection.calls, 'MessageHistory')).toHaveLength(2);
		});

		it('saves message history with correct guild association', async () => {
			const connection = makeConnection();
			const guildId = '777000000000000001';
			GetGuild.mockResolvedValue(makeGuild(GUILD_FEATURES.MESSAGE_SAVING | GUILD_FEATURES.MESSAGE_HISTORY, guildId));
			GetUser.mockResolvedValue(makeUser());
			getConnection.mockResolvedValue(connection);

			await MessageCreateHandler.execute(makeMessage({ guildId }));
			await ProcessMessages({ quiet: true });

			const insert = findInserts(connection.calls, 'MessageHistory')[0]!;
			// columns: created_at, guild_id, channel_id
			expect(insert.params[1]).toBe(BigInt(guildId));
		});

		it('saves message history with correct channel association', async () => {
			const connection = makeConnection();
			const channelId = '888000000000000001';
			GetGuild.mockResolvedValue(makeGuild(GUILD_FEATURES.MESSAGE_SAVING | GUILD_FEATURES.MESSAGE_HISTORY));
			GetUser.mockResolvedValue(makeUser());
			getConnection.mockResolvedValue(connection);

			await MessageCreateHandler.execute(makeMessage({ channelId }));
			await ProcessMessages({ quiet: true });

			const insert = findInserts(connection.calls, 'MessageHistory')[0]!;
			expect(insert.params[2]).toBe(BigInt(channelId));
		});

		it('does not save message history for guilds without MESSAGE_HISTORY feature', async () => {
			const connection = makeConnection();
			GetGuild.mockResolvedValue(makeGuild(GUILD_FEATURES.MESSAGE_SAVING)); // no MESSAGE_HISTORY
			GetUser.mockResolvedValue(makeUser());
			getConnection.mockResolvedValue(connection);

			await MessageCreateHandler.execute(makeMessage({}));
			await ProcessMessages({ quiet: true });

			expect(findInserts(connection.calls, 'MessageHistory')).toHaveLength(0);
			// content saving is independent of MESSAGE_HISTORY - it should still happen
			expect(findInserts(connection.calls, 'Messages')).toHaveLength(1);
		});
	});
});
