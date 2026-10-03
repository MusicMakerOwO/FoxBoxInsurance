import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ButtonHandler } from '../../../Typings/HandlerTypes.js';
import { ExpectValidResponse, HandlerResult, customIDs, embedOf, makeInteraction } from '../Helpers.js';

/**
 * `global-stats` - figures over the newest 10,000 saved messages, recomputed at most every 30 minutes.
 *
 * The result is cached in module state, so the handler is re-imported for every test. Both reads go
 * through the self-releasing `Database.query`; a `getConnection` call would mean a connection is held
 * by hand again (it leaked when a query threw), so it's asserted never made.
 */

const { query, getConnection } = vi.hoisted(() => ({
	query        : vi.fn(),
	getConnection: vi.fn()
}));
vi.mock('../../../Database.js', () => ({ Database: { query, getConnection } }));

const NOW = Date.UTC(2026, 6, 15, 12);
const MINUTE = 60_000;

type Row = {
	id: bigint, guild_id: bigint, channel_id: bigint, user_id: bigint,
	sticker_id: bigint | null, length: number | null, created_at: Date,
	data: { attachments: { id: string }[], emoji_ids: string[] }
};

let messages: Row[];
/** Asset sizes by discord_id - an attachment without an entry was never downloaded */
let assets: Map<string, number>;
/** Set to make the matching query reject */
let failing: 'Messages' | 'Assets' | null;
let GlobalStats: ButtonHandler;

let nextID = 1n;
/** Newest first, like the query returns them - each call is one minute older than the last */
function message(overrides: { user?: bigint, guild?: bigint, channel?: bigint, sticker?: bigint, length?: number, emojis?: number, attachments?: string[], at?: number } = {}): Row {
	const id = nextID++;
	return {
		id,
		guild_id  : overrides.guild ?? 1n,
		channel_id: overrides.channel ?? 10n,
		user_id   : overrides.user ?? 100n,
		sticker_id: overrides.sticker ?? null,
		length    : overrides.length ?? 10,
		created_at: new Date(overrides.at ?? NOW - Number(id) * MINUTE),
		data      : {
			attachments: (overrides.attachments ?? []).map(attachmentID => ({ id: attachmentID })),
			emoji_ids  : Array.from({ length: overrides.emojis ?? 0 }, (_, i) => String(i))
		}
	};
}

function queriesTo(table: 'Messages' | 'Assets') {
	return query.mock.calls.filter(([ sql ]) => new RegExp(`FROM ${table}`).test(sql as string));
}

beforeEach(async () => {
	vi.clearAllMocks();
	vi.resetModules();
	vi.useFakeTimers({ toFake: [ 'Date' ] });
	vi.setSystemTime(NOW);
	vi.spyOn(console, 'time').mockImplementation(() => undefined);
	vi.spyOn(console, 'timeEnd').mockImplementation(() => undefined);

	nextID = 1n;
	messages = [];
	assets = new Map();
	failing = null;

	query.mockImplementation(async (sql: string, params: string[] = []) => {
		const table = /FROM (\w+)/.exec(sql)![1];
		if (failing === table) throw new Error(`${table} failed`);
		if (table === 'Messages') return messages;
		if (table === 'Assets') {
			// MariaDB rejects `IN ()`, and binds exactly one param per placeholder
			const placeholders = (sql.match(/\?/g) ?? []).length;
			if (placeholders === 0) throw new Error('syntax error near IN ()');
			return params.slice(0, placeholders).filter(id => assets.has(id)).map(id => ({ discord_id: BigInt(id), size: assets.get(id)! }));
		}
		throw new Error(`unexpected query: ${sql}`);
	});

	GlobalStats = (await import('../../../Buttons/GlobalStats.js')).default;
});

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
});

async function stats(): Promise<HandlerResult> {
	const result = await GlobalStats.execute(makeInteraction(), {} as never, []);
	await ExpectValidResponse(result, GlobalStats);
	return result;
}

async function description(): Promise<string> {
	return embedOf(await stats()).description!;
}

describe('global-stats - an empty or thin sample', () => {
	// Bug: `selectedMessages[0].created_at` threw on an empty table
	it('renders a "no data yet" embed for an empty Messages table', async () => {
		const result = await stats();

		expect(embedOf(result).description).toMatch(/No messages have been saved yet/);
		expect(customIDs(result)).toEqual([ 'bot-info' ]);
		expect(queriesTo('Assets')).toHaveLength(0);
	});

	it('does not cache the empty result, so the stats appear as soon as there are messages', async () => {
		await stats();
		messages = [ message() ];

		expect(await description()).toContain('Last 1 messages');
	});

	// Bug: the Assets query was sent as `IN ()` - a syntax error
	it('skips the Assets query when no message has an attachment', async () => {
		messages = [ message(), message() ];
		await stats();

		expect(queriesTo('Assets')).toHaveLength(0);
	});

	// Bug: 0 / 0 and x / 0 rendered as NaN, Infinity and "Infinity GB"
	it.each([
		[ 'one plain message', () => [ message() ] ],
		[ 'messages sharing one timestamp', () => [ message({ at: NOW }), message({ at: NOW }) ] ],
		[ 'an attachment that was never downloaded', () => [ message({ attachments: [ '500' ] }) ] ],
		[ 'messages with no recorded length', () => [ { ...message(), length: null } ] ]
	])('renders numbers, not NaN or Infinity, for %s', async (_, build) => {
		messages = build();
		const text = await description();

		expect(text).not.toMatch(/NaN|Infinity|undefined|null/);
	});

	it('renders zeroes for the emoji, file and rate figures of one plain message', async () => {
		messages = [ message() ];
		const text = await description();

		expect(text).toContain('Emoji Stats (0 emojis)');
		expect(text).toContain('- Avg emojis: 0.00 emojis/msg');
		expect(text).toContain('Files Stats (0 files)');
		expect(text).toContain('- Max size: 0 byte(s)');
		expect(text).toContain('- Min size: 0 byte(s)');
		expect(text).toContain('- Avg files: 0.00 files/msg');
		expect(text).toContain('0.00 messages are sent per minute');
	});
});

describe('global-stats - figures', () => {
	// Bug: every figure divided by STAT_SIZE (10,000) even when fewer messages were read
	it('uses the number of messages actually read', async () => {
		// 4 messages over 3 minutes, from 2 users
		messages = [
			message({ user: 100n, sticker: 7n }),
			message({ user: 100n, attachments: [ '500' ] }),
			message({ user: 200n, attachments: [ '501' ] }),
			message({ user: 200n })
		];
		assets = new Map([ [ '500', 10 ], [ '501', 20 ] ]);
		const text = await description();

		expect(text).toContain('Last 4 messages');
		expect(text).toContain('- Users: 2 (2.00 msg/user)');
		expect(text).toContain('Only 25.00% of messages have a sticker');
		expect(text).toContain('Only 50.00% of messages have a file');
		expect(text).toContain('The average user sent 2.00 messages');
		expect(text).toContain('On average, 1.33 messages are sent per minute');
	});

	it('counts distinct guilds, channels and users, and averages the length', async () => {
		messages = [
			message({ guild: 1n, channel: 10n, user: 100n, length: 10 }),
			message({ guild: 1n, channel: 11n, user: 101n, length: 20 }),
			message({ guild: 2n, channel: 20n, user: 102n, length: 31 })
		];
		const text = await description();

		expect(text).toContain('- Guilds: 2');
		expect(text).toContain('- Channels: 3');
		expect(text).toContain('- Users: 3 (1.00 msg/user)');
		expect(text).toContain('- Avg Length: 20 characters');
	});

	it('the same sticker used twice is two messages with a sticker', async () => {
		messages = [ message({ sticker: 7n }), message({ sticker: 7n }), message(), message() ];
		expect(await description()).toContain('Only 50.00% of messages have a sticker');
	});

	it('emoji figures count emojis, averaged over the messages that have any', async () => {
		messages = [ message({ emojis: 3 }), message({ emojis: 1 }), message() ];
		const text = await description();

		expect(text).toContain('Emoji Stats (4 emojis)');
		expect(text).toContain('- Max emojis: 3 emojis');
		expect(text).toContain('- Avg emojis: 2.00 emojis/msg');
	});

	// Bug: one placeholder per message but one param per attachment - the later ids were never looked up
	it('looks up every attachment of a message holding several', async () => {
		messages = [ message({ attachments: [ '500', '501', '502' ] }), message({ attachments: [ '503' ] }) ];
		assets = new Map([ [ '500', 2048 ], [ '501', 100 ], [ '502', 5 * 1024 * 1024 ], [ '503', 4096 ] ]);
		const text = await description();

		const [ sql, params ] = queriesTo('Assets')[0];
		expect(params).toEqual([ '500', '501', '502', '503' ]);
		expect((sql as string).match(/\?/g)).toHaveLength(4);

		expect(text).toContain('Files Stats (4 files)');
		expect(text).toContain('- Max size: 5.00 MB');
		expect(text).toContain('- Min size: 100 byte(s)');
		expect(text).toContain('- Avg files: 2.00 files/msg');
	});

	it('stays within Discord limits at worst-case magnitudes', async () => {
		messages = Array.from({ length: 2000 }, (_, i) => message({
			guild: BigInt(i), channel: BigInt(i), user: BigInt(i), sticker: 7n, length: 4000, emojis: 50, attachments: [ String(10_000 + i), String(20_000 + i) ]
		}));
		for (const row of messages) for (const { id } of row.data.attachments) assets.set(id, Number.MAX_SAFE_INTEGER);

		await stats(); // ExpectValidResponse runs inside
	});

	it('Back leads to bot-info', async () => {
		messages = [ message() ];
		expect(customIDs(await stats())).toEqual([ 'bot-info' ]);
	});
});

describe('global-stats - caching and failures', () => {
	it('reuses the result within 30 minutes', async () => {
		messages = [ message() ];
		const first = await description();

		messages = [ message(), message(), message() ];
		vi.setSystemTime(NOW + 29 * MINUTE);

		expect(await description()).toBe(first);
		expect(queriesTo('Messages')).toHaveLength(1);
	});

	it('recomputes after 30 minutes', async () => {
		messages = [ message() ];
		await stats();

		messages = [ message(), message(), message() ];
		vi.setSystemTime(NOW + 30 * MINUTE);

		expect(await description()).toContain('Last 3 messages');
		expect(queriesTo('Messages')).toHaveLength(2);
	});

	it('the update times shown are when it was computed and 30 minutes on', async () => {
		messages = [ message() ];
		const text = await description();

		expect(text).toContain(`Last updated <t:${NOW / 1000}:R>`);
		expect(text).toContain(`Next update <t:${(NOW + 30 * MINUTE) / 1000}:R>`);
	});

	// Bug: a hand-released connection with no try/finally leaked whenever a query threw
	it.each([ 'Messages', 'Assets' ] as const)('holds no connection when the %s query throws, and caches nothing', async (table) => {
		messages = [ message({ attachments: [ '500' ] }) ];
		failing = table;
		await expect(GlobalStats.execute(makeInteraction(), {} as never, [])).rejects.toThrow(`${table} failed`);
		expect(getConnection).not.toHaveBeenCalled();

		failing = null;
		expect(await description()).toContain('Last 1 messages');
	});
});
