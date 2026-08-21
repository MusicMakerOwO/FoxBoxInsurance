import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FORMAT } from '../Utils/Constants.js';
import { SimpleEmoji, SimpleMessage, SimpleSticker, SimpleUser } from '../Typings/DatabaseTypes.js';

const { getConnection, releaseConnection } = vi.hoisted(() => ({
	getConnection: vi.fn(),
	releaseConnection: vi.fn()
}));
vi.mock('../Database.js', () => ({ Database: { getConnection, releaseConnection } }));

const { GetUser } = vi.hoisted(() => ({ GetUser: vi.fn() }));
vi.mock('../CRUD/Users.js', () => ({ GetUser }));

const { GetSticker } = vi.hoisted(() => ({ GetSticker: vi.fn() }));
vi.mock('../CRUD/Stickers.js', () => ({ GetSticker }));

const { GetEmoji } = vi.hoisted(() => ({ GetEmoji: vi.fn() }));
vi.mock('../CRUD/Emojis.js', () => ({ GetEmoji }));

const { GetAsset } = vi.hoisted(() => ({ GetAsset: vi.fn() }));
vi.mock('../CRUD/Assets.js', () => ({ GetAsset }));

const { ResolveUserKeyBulk } = vi.hoisted(() => ({ ResolveUserKeyBulk: vi.fn() }));
vi.mock('../Services/UserEncryptionKeys.js', () => ({ ResolveUserKeyBulk }));

import { ExportChannel, ExportOptions, JSONExport } from '../Utils/Parsers/Export.js';

type FullMessageRow = Pick<SimpleMessage, 'id' | 'user_id' | 'content' | 'sticker_id' | 'reply_to' | 'data' | 'created_at' | 'encryption_version'>;

type Fixture = {
	owner: { id: bigint, username: string, bot: 0 | 1 },
	guild: { id: bigint, name: string },
	channel: { id: bigint, name: string, type: number },
	messages: FullMessageRow[]
};

function makeConnection(fixture: Fixture) {
	const query = vi.fn(async (sql: string, params: unknown[] = []) => {
		if (sql.includes('WHERE channel_id')) {
			const limit = Number(params[1]);
			return fixture.messages
			.slice()
			.sort((a, b) => (a.id > b.id ? -1 : 1)) // newest first, per ORDER BY id DESC
			.slice(0, limit)
			.map(m => ({ id: m.id }));
		}
		if (sql.includes('WHERE id IN')) {
			const ids = new Set(params.map(String));
			const rows = fixture.messages.filter(m => ids.has(m.id.toString()));
			// A real DB gives no ordering guarantee for IN(...) without an explicit ORDER BY -
			// only honor ascending order if the query actually asks for it, so a regression here is caught.
			if (!sql.includes('ORDER BY id ASC')) return rows;
			return rows.sort((a, b) => (a.id < b.id ? -1 : 1));
		}
		if (sql.includes('FROM Users')) return [fixture.owner];
		if (sql.includes('FROM Exports')) return [];
		if (sql.includes('FROM Guilds')) return [fixture.guild];
		if (sql.includes('FROM Channels')) return [fixture.channel];
		throw new Error(`Unhandled mock query: ${sql}`);
	});
	return { query };
}

function makeOptions(overrides: Partial<ExportOptions> = {}): ExportOptions {
	return {
		guildID: 100n,
		channelID: 200n,
		userID: 300n,
		format: FORMAT.JSON,
		messageCount: 10,
		...overrides
	};
}

const RELEVANT_USER_A = 400n; // Alice - authors two messages
const RELEVANT_USER_B = 401n; // Bob - authors one message
const UNRELATED_USER = 499n; // never authors a message in these fixtures
const RELEVANT_EMOJI = 600000000000000001n;
const UNRELATED_EMOJI = 699999999999999999n;
const RELEVANT_STICKER = 500000000000000001n;
const UNRELATED_STICKER = 599999999999999999n;

function baseFixture(): Fixture {
	return {
		owner: { id: 300n, username: 'exporter', bot: 0 },
		guild: { id: 100n, name: 'Test Guild' },
		channel: { id: 200n, name: 'general', type: 0 },
		messages: [
			{
				id: 1001n, user_id: RELEVANT_USER_A,
				content: Buffer.from('Hello there', 'utf8'),
				sticker_id: null, reply_to: null,
				data: { attachments: [], emoji_ids: [], embeds: [], components: [] },
				created_at: new Date('2025-01-01T00:00:00Z'),
				encryption_version: null
			},
			{
				id: 1002n, user_id: RELEVANT_USER_B,
				content: Buffer.from('Reacting with an emoji', 'utf8'),
				sticker_id: null, reply_to: null,
				data: { attachments: [], emoji_ids: [String(RELEVANT_EMOJI)], embeds: [], components: [] },
				created_at: new Date('2025-01-01T00:01:00Z'),
				encryption_version: null
			},
			{
				id: 1003n, user_id: RELEVANT_USER_A,
				content: Buffer.from('Sticker time', 'utf8'),
				sticker_id: RELEVANT_STICKER, reply_to: null,
				data: { attachments: [], emoji_ids: [], embeds: [], components: [] },
				created_at: new Date('2025-01-01T00:02:00Z'),
				encryption_version: null
			}
		]
	};
}

function setupMocks(fixture: Fixture) {
	getConnection.mockResolvedValue(makeConnection(fixture));

	GetUser.mockImplementation(async (id: bigint) => {
		const users: Record<string, SimpleUser> = {
			[RELEVANT_USER_A.toString()]: {
				id: RELEVANT_USER_A, username: 'alice', bot: 0, terms_version_accepted: 3,
				wrapped_key: Buffer.from('secret-key'), rotation_hour: 4, opt_out_collection: 0
			},
			[RELEVANT_USER_B.toString()]: {
				id: RELEVANT_USER_B, username: 'bob', bot: 0, terms_version_accepted: 2,
				wrapped_key: null, rotation_hour: 5, opt_out_collection: 0
			}
		};
		return users[id.toString()] ?? null;
	});

	GetEmoji.mockImplementation(async (id: bigint) => {
		if (id === RELEVANT_EMOJI) {
			return { id: RELEVANT_EMOJI, name: 'wave', animated: 0, internal_note: 'should not leak' } as unknown as SimpleEmoji;
		}
		return null;
	});

	GetSticker.mockImplementation(async (id: bigint) => {
		if (id === RELEVANT_STICKER) {
			return { id: RELEVANT_STICKER, name: 'Cool Sticker', internal_note: 'should not leak' } as unknown as SimpleSticker;
		}
		return null;
	});

	GetAsset.mockResolvedValue(null);
	ResolveUserKeyBulk.mockResolvedValue(new Map());
}

async function exportJSON(overrides: Partial<ExportOptions> = {}): Promise<JSONExport> {
	const result = await ExportChannel(makeOptions({ format: FORMAT.JSON, ...overrides }));
	return JSON.parse(result.data.toString('utf8')) as JSONExport;
}

beforeEach(() => {
	getConnection.mockReset();
	releaseConnection.mockReset();
	GetUser.mockReset();
	GetSticker.mockReset();
	GetEmoji.mockReset();
	GetAsset.mockReset();
	ResolveUserKeyBulk.mockReset();
});

describe('ExportChannel', () => {
	it('should not export more than 10,000 messages', async () => {
		await expect(ExportChannel(makeOptions({ messageCount: 10_001 }))).rejects.toThrow('Cannot export more than 10,000 messages');
	});

	it('should not export 0 messages', async () => {
		await expect(ExportChannel(makeOptions({ messageCount: 0 }))).rejects.toThrow('Cannot export 0 messages');
	});

	it('should export a text format without error', async () => {
		setupMocks(baseFixture());
		const result = await ExportChannel(makeOptions({ format: FORMAT.TEXT }));
		expect(result.data.length).toBeGreaterThan(0);
	});

	it('should export a HTML format without error', async () => {
		setupMocks(baseFixture());
		const result = await ExportChannel(makeOptions({ format: FORMAT.HTML }));
		expect(result.data.length).toBeGreaterThan(0);
	});

	it('should contain all the required metadata and warnings', async () => {
		setupMocks(baseFixture());
		const result = await exportJSON();

		expect(result.export.owner).toBe('@exporter (300)');
		expect(result.export.guild).toBe('Test Guild (100)');
		expect(result.export.channel).toBe('#general (200)');
		expect(result.export.id).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
		expect(result.export.warning).toContain('notfbi.dev/invite');
		expect(result.export.warning).toContain('/verify');
	});

	it('should contain the guild info', async () => {
		setupMocks(baseFixture());
		const result = await exportJSON();
		expect(result.guild).toEqual({ id: '100', name: 'Test Guild' });
	});

	it('should contain the channel info', async () => {
		setupMocks(baseFixture());
		const result = await exportJSON();
		expect(result.channel).toEqual({ id: '200', name: 'general', type: 0 });
	});

	it('should only contain relevant users', async () => {
		setupMocks(baseFixture());
		const result = await exportJSON();

		expect(Object.keys(result.users).sort()).toEqual([RELEVANT_USER_A.toString(), RELEVANT_USER_B.toString()].sort());
		expect(GetUser).not.toHaveBeenCalledWith(UNRELATED_USER);
	});

	it('should only export public data for users', async () => {
		setupMocks(baseFixture());
		const result = await exportJSON();

		expect(result.users[RELEVANT_USER_A.toString()]).toEqual({ id: '400', username: 'alice', bot: 0 });
	});

	it('should only contain relevant emojis', async () => {
		setupMocks(baseFixture());
		const result = await exportJSON();

		expect(Object.keys(result.emojis)).toEqual([RELEVANT_EMOJI.toString()]);
		expect(GetEmoji).not.toHaveBeenCalledWith(UNRELATED_EMOJI);
	});

	it('should only export public data for emojis', async () => {
		setupMocks(baseFixture());
		const result = await exportJSON();

		expect(result.emojis[RELEVANT_EMOJI.toString()]).toEqual({ id: RELEVANT_EMOJI.toString(), name: 'wave', animated: 0 });
	});

	it('should only contain relevant stickers', async () => {
		setupMocks(baseFixture());
		const result = await exportJSON();

		expect(Object.keys(result.stickers)).toEqual([RELEVANT_STICKER.toString()]);
		expect(GetSticker).not.toHaveBeenCalledWith(UNRELATED_STICKER);
	});

	it('should only export public data for sticker', async () => {
		setupMocks(baseFixture());
		const result = await exportJSON();

		expect(result.stickers[RELEVANT_STICKER.toString()]).toEqual({ id: RELEVANT_STICKER.toString(), name: 'Cool Sticker' });
	});

	it('should contain message IDs in ascending order', async () => {
		const fixture = baseFixture();
		fixture.messages.reverse(); // scramble insertion/fetch order to prove the export re-sorts
		setupMocks(fixture);

		const result = await exportJSON();

		expect(result.messages.map(m => m.id)).toEqual(['1001', '1002', '1003']);
	});

	it('should contain the original message data minus private data', async () => {
		setupMocks(baseFixture());
		const result = await exportJSON();

		const message = result.messages.find(m => m.id === '1001')!;
		expect(message).toMatchObject({
			id: '1001',
			user_id: RELEVANT_USER_A.toString(),
			content: 'Hello there',
			sticker_id: null,
			reply_to: null
		});
		expect(message).not.toHaveProperty('encryption_version');
	});
});
