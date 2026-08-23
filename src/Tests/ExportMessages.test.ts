import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FORMAT } from '../Utils/Constants.js';
import { SimpleEmoji, SimpleMessage, SimpleSticker, SimpleUser } from '../Typings/DatabaseTypes.js';

const { getConnection, releaseConnection } = vi.hoisted(() => ({
	getConnection: vi.fn(),
	releaseConnection: vi.fn()
}));
vi.mock('../Database.js', () => ({ Database: { getConnection, releaseConnection } }));

const { GetUserBulk } = vi.hoisted(() => ({ GetUserBulk: vi.fn() }));
vi.mock('../CRUD/Users.js', () => ({ GetUserBulk }));

const { GetStickerBulk } = vi.hoisted(() => ({ GetStickerBulk: vi.fn() }));
vi.mock('../CRUD/Stickers.js', () => ({ GetStickerBulk }));

const { GetEmojiBulk } = vi.hoisted(() => ({ GetEmojiBulk: vi.fn() }));
vi.mock('../CRUD/Emojis.js', () => ({ GetEmojiBulk }));

const { GetAssetBulk } = vi.hoisted(() => ({ GetAssetBulk: vi.fn() }));
vi.mock('../CRUD/Assets.js', () => ({ GetAssetBulk }));

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

	GetUserBulk.mockImplementation(async (ids: bigint[]) => {
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
		return new Map(ids.map(id => [id, users[id.toString()] ?? null]));
	});

	GetEmojiBulk.mockImplementation(async (ids: bigint[]) => {
		return new Map(ids.map(id => [id, id === RELEVANT_EMOJI
			? { id: RELEVANT_EMOJI, name: 'wave', animated: 0, internal_note: 'should not leak' } as unknown as SimpleEmoji
			: null]));
	});

	GetStickerBulk.mockImplementation(async (ids: bigint[]) => {
		return new Map(ids.map(id => [id, id === RELEVANT_STICKER
			? { id: RELEVANT_STICKER, name: 'Cool Sticker', internal_note: 'should not leak' } as unknown as SimpleSticker
			: null]));
	});

	GetAssetBulk.mockImplementation(async (ids: bigint[]) => new Map(ids.map(id => [id, null])));
	ResolveUserKeyBulk.mockResolvedValue(new Map());
}

async function exportJSON(overrides: Partial<ExportOptions> = {}): Promise<JSONExport> {
	const result = await ExportChannel(makeOptions({ format: FORMAT.JSON, ...overrides }));
	return JSON.parse(result.data.toString('utf8')) as JSONExport;
}

beforeEach(() => {
	getConnection.mockReset();
	releaseConnection.mockReset();
	GetUserBulk.mockReset();
	GetStickerBulk.mockReset();
	GetEmojiBulk.mockReset();
	GetAssetBulk.mockReset();
	ResolveUserKeyBulk.mockReset();
});

describe('ExportChannel', () => {
	it('should not export more than 10,000 messages', async () => {
		await expect(ExportChannel(makeOptions({ messageCount: 10_001 }))).rejects.toThrow('Cannot export more than 10,000 messages');
	});

	it('should not export 0 messages', async () => {
		await expect(ExportChannel(makeOptions({ messageCount: 0 }))).rejects.toThrow('Cannot export 0 messages');
	});

	it('should throw and still release the connection when the channel has no stored messages', async () => {
		const fixture = baseFixture();
		fixture.messages = [];
		setupMocks(fixture);

		await expect(ExportChannel(makeOptions())).rejects.toThrow('No messages to export');
		expect(releaseConnection).toHaveBeenCalledTimes(1);
	});

	it('should export a text format without error', async () => {
		setupMocks(baseFixture());
		const result = await ExportChannel(makeOptions({ format: FORMAT.TEXT }));
		expect(result.data.length).toBeGreaterThan(0);
	});

	it('renders midnight as 12am, not 0am', async () => {
		setupMocks(baseFixture()); // messages created at 00:00-00:02 UTC
		const result = await ExportChannel(makeOptions({ format: FORMAT.TEXT }));
		const text = result.data.toString('utf8');

		expect(text).toContain('12:00am UTC');
		expect(text).not.toMatch(/\b0:00am/);
	});

	it('renders noon as 12pm, not 12am', async () => {
		const fixture = baseFixture();
		fixture.messages = [fixture.messages[0]];
		fixture.messages[0].created_at = new Date('2025-01-01T12:30:00Z');
		setupMocks(fixture);

		const result = await ExportChannel(makeOptions({ format: FORMAT.TEXT }));
		const text = result.data.toString('utf8');

		expect(text).toContain('12:30pm UTC');
		expect(text).not.toContain('12:30am UTC');
	});

	it('emits a date separator for messages on different calendar days exactly one week apart', async () => {
		const fixture = baseFixture();
		fixture.messages = [
			fixture.messages[0], // 2025-01-01T00:00:00Z, a Wednesday
			{
				...fixture.messages[0],
				id: 1004n,
				created_at: new Date('2025-01-08T00:00:00Z') // also a Wednesday, 7 days later
			}
		];
		setupMocks(fixture);

		const result = await ExportChannel(makeOptions({ format: FORMAT.TEXT }));
		const text = result.data.toString('utf8');

		const separators = text.match(/----------\s\[/g) ?? [];
		expect(separators.length).toBe(2);
	});

	it('does not emit a spurious date separator for messages on the same day of different weeks', async () => {
		const fixture = baseFixture();
		fixture.messages = [
			{ ...fixture.messages[0], created_at: new Date('2025-01-01T00:00:00Z') },
			{ ...fixture.messages[0], id: 1004n, created_at: new Date('2025-01-01T23:00:00Z') }
		];
		setupMocks(fixture);

		const result = await ExportChannel(makeOptions({ format: FORMAT.TEXT }));
		const text = result.data.toString('utf8');

		const separators = text.match(/----------\s\[/g) ?? [];
		expect(separators.length).toBe(1);
	});

	it('should export a HTML format without error', async () => {
		setupMocks(baseFixture());
		const result = await ExportChannel(makeOptions({ format: FORMAT.HTML }));
		expect(result.data.length).toBeGreaterThan(0);
	});

	it('should not let message content break out of the inline <script> block in HTML exports', async () => {
		const fixture = baseFixture();
		fixture.messages[0].content = Buffer.from(
			'</script><script>alert(document.domain)</script><script>', 'utf8'
		);
		setupMocks(fixture);

		const result = await ExportChannel(makeOptions({ format: FORMAT.HTML }));
		const html = result.data.toString('utf8');

		// An unescaped export would emit this exact unescaped sequence as a real,
		// executing <script> element - a browser's HTML tokenizer ends the *legitimate*
		// script block at the first literal `</script`, regardless of JS string context.
		expect(html).not.toContain('<script>alert(document.domain)</script>');
		// The payload should still be present, just neutralized inside the JSON string.
		expect(html).toContain('alert(document.domain)');
	});

	it('should not corrupt HTML exports when message content contains $-replacement patterns', async () => {
		const fixture = baseFixture();
		fixture.messages[0].content = Buffer.from('price is $&, not $$1', 'utf8');
		setupMocks(fixture);

		const result = await ExportChannel(makeOptions({ format: FORMAT.HTML }));
		const html = result.data.toString('utf8');

		expect(html).not.toContain('{{EXPORT_DATA}}');
		expect(html).toContain('price is $&, not $$1');
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
		expect(GetUserBulk.mock.calls[0]![0]).not.toContain(UNRELATED_USER);
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
		expect(GetEmojiBulk.mock.calls[0]![0]).not.toContain(UNRELATED_EMOJI);
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
		expect(GetStickerBulk.mock.calls[0]![0]).not.toContain(UNRELATED_STICKER);
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
