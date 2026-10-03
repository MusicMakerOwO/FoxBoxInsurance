import { describe, it, expect, vi, beforeEach } from 'vitest';
import { IClient } from '../../../Client.js';
import { SimpleMessageExport } from '../../../Typings/DatabaseTypes.js';
import { FORMAT } from '../../../Utils/Constants.js';
import { ExpectValidResponse, HandlerResult, buttonsOf, embedOf, makeClient, makeInteraction, screen, selectsOf } from '../Helpers.js';

/**
 * `history` - the user's exports, 5 per page, with a select into `exportInfo` and a nav row.
 * `/history` delegates to it with page 0.
 *
 * The DB is an in-memory list of exports behind a fake connection. Like the real `getConnection`,
 * disposing it calls `releaseConnection`, so a leak shows up as a checkout without a release.
 */

const { getConnection, releaseConnection, query, GetGuild, GetChannel, calls } = vi.hoisted(() => ({
	getConnection    : vi.fn(),
	releaseConnection: vi.fn(),
	query            : vi.fn(),
	GetGuild         : vi.fn(),
	GetChannel       : vi.fn(),
	/** Checkouts, releases and name lookups in the order they happened */
	calls            : [] as string[]
}));
vi.mock('../../../Database.js', () => ({ Database: { getConnection, releaseConnection, query } }));
vi.mock('../../../CRUD/Guilds.js', async (importOriginal) => ({ ...await importOriginal<object>(), GetGuild }));
vi.mock('../../../CRUD/Channels.js', async (importOriginal) => ({ ...await importOriginal<object>(), GetChannel }));

const History = (await import('../../../Buttons/History.js')).default;
const HistoryCommand = (await import('../../../Commands/History.js')).default;

const USER_ID = '900000000000000005';

let exports: SimpleMessageExport[];
/** Set to make the matching query reject */
let failing: 'count' | 'page' | null;
let client: IClient;

function makeExports(count: number): SimpleMessageExport[] {
	return Array.from({ length: count }, (_, i) => ({
		id           : `AAAA-BBBB-CCCC-${String(i).padStart(4, '0')}`,
		guild_id     : 100n + BigInt(i),
		channel_id   : 200n + BigInt(i),
		user_id      : BigInt(USER_ID),
		message_count: 100,
		format       : FORMAT.HTML,
		hash         : `hash-${i}`,
		hash_algorithm: 'sha256',
		lookup       : `lookup-${i}`,
		created_at   : 1_700_000_000 - i
	}));
}

/** Answers the COUNT and the paged SELECT from `exports`, recording the OFFSET it was asked for */
function FakeConnection() {
	const connection = {
		query: vi.fn(async (sql: string, params: unknown[]) => {
			if (/COUNT\(\*\)/.test(sql)) {
				if (failing === 'count') throw new Error('count failed');
				return [{ count: BigInt(exports.length) }];
			}
			if (failing === 'page') throw new Error('page failed');
			const offset = params[1] as number;
			return exports.slice(offset, offset + 5);
		}),
		[Symbol.dispose]: () => releaseConnection(connection)
	};
	return connection;
}

let connection: ReturnType<typeof FakeConnection>;

beforeEach(async () => {
	vi.clearAllMocks();
	calls.length = 0;
	exports = makeExports(12);
	failing = null;

	connection = FakeConnection();
	getConnection.mockImplementation(async () => { calls.push('checkout'); return connection; });
	releaseConnection.mockImplementation(() => { calls.push('release'); });
	GetGuild.mockImplementation(async (id: bigint) => { calls.push('GetGuild'); return { id, name: `Guild ${id}` }; });
	GetChannel.mockImplementation(async (id: bigint) => { calls.push('GetChannel'); return { id, name: `channel-${id}` }; });

	client = await makeClient();
});

async function history(arg: string): Promise<HandlerResult> {
	const result = await History.execute(makeInteraction({ userId: USER_ID, memberPerms: [] }), client, [ arg ]);
	await ExpectValidResponse(result, History);
	return result;
}

/** The OFFSET the paged SELECT was run with */
function offsetQueried(): number {
	const page = connection.query.mock.calls.find(([ sql ]) => !/COUNT\(\*\)/.test(sql));
	if (!page) throw new Error('the paged SELECT never ran');
	return page[1][1] as number;
}

function counter(result: HandlerResult): string | undefined {
	return buttonsOf(result).find(button => 'custom_id' in button && button.custom_id === 'null')?.label;
}

/** `first` / `prev` / `next` / `last` disabled flags, in order */
function navDisabled(result: HandlerResult): boolean[] {
	return buttonsOf(result)
		.filter(button => 'custom_id' in button && button.custom_id !== 'null')
		.map(button => button.disabled ?? false);
}

function expectReleased() {
	expect(getConnection).toHaveBeenCalledOnce();
	expect(releaseConnection).toHaveBeenCalledExactlyOnceWith(connection);
}

describe('history - connection handling', () => {
	// Bug: the early return skipped releaseConnection
	it('shows NoExports and releases the connection when there are no exports', async () => {
		exports = [];
		const result = await history('0');

		expect(embedOf(result).description).toMatch(/no export history/);
		expectReleased();
	});

	// Bug: the update kept the previous screen's select and nav live under the new embed
	it('clears the old select and nav on the NoExports screen', async () => {
		exports = [];
		expect(screen(await history('0')).components).toEqual([]);
	});

	// Bug: no try/finally
	it.each([ 'count', 'page' ] as const)('releases the connection when the %s query throws', async (which) => {
		failing = which;

		await expect(History.execute(makeInteraction({ userId: USER_ID }), client, [ '0' ])).rejects.toThrow(`${which} failed`);
		expectReleased();
	});

	// GetGuild / GetChannel check out their own connections - holding ours across them doubles the load
	it('releases the connection before looking up guild and channel names', async () => {
		await history('0');

		expect(calls.indexOf('release')).toBeGreaterThan(-1);
		expect(calls.indexOf('release')).toBeLessThan(calls.indexOf('GetGuild'));
		expect(calls.indexOf('release')).toBeLessThan(calls.indexOf('GetChannel'));
	});
});

describe('history - paging', () => {
	it.each([
		[ 'first', 12, 0  ],
		[ '1'    , 12, 5  ],
		[ 'last' , 12, 10 ],
		[ 'last' , 5 , 0  ],
		[ 'last' , 6 , 5  ]
	])('%s with %i exports reads from OFFSET %i', async (arg, count, offset) => {
		exports = makeExports(count);
		await history(arg);

		expect(offsetQueried()).toBe(offset);
	});

	it.each([ 'abc', '-3' ])('treats %s as the first page', async (arg) => {
		await history(arg);
		expect(offsetQueried()).toBe(0);
	});

	// Unreachable today (nothing deletes exports), kept as a guard: an empty select is rejected by Discord
	it('clamps a page past the end to the last page', async () => {
		exports = makeExports(6);
		const result = await history('9');

		expect(offsetQueried()).toBe(5);
		expect(selectsOf(result)[0].options).toHaveLength(1);
		expect(counter(result)).toBe('2 / 2');
	});

	it.each([
		[ 'the first page' , '0'   , [ true , true , false, false ], '1 / 3' ],
		[ 'a middle page'  , '1'   , [ false, false, false, false ], '2 / 3' ],
		[ 'the last page'  , 'last', [ false, false, true , true  ], '3 / 3' ]
	])('nav on %s', async (_, arg, disabled, label) => {
		const result = await history(arg);

		expect(navDisabled(result)).toEqual(disabled);
		expect(counter(result)).toBe(label);
	});

	it('disables the whole nav when everything fits on one page', async () => {
		exports = makeExports(3);
		const result = await history('0');

		expect(navDisabled(result)).toEqual([ true, true, true, true ]);
		expect(counter(result)).toBe('1 / 1');
	});
});

describe('history - rendering', () => {
	it('lists one select option per export on the page, valued by export id', async () => {
		const result = await history('1');

		expect(selectsOf(result)).toHaveLength(1);
		expect(selectsOf(result)[0].custom_id).toBe('exportInfo');
		expect(selectsOf(result)[0].options.map(option => option.value)).toEqual(exports.slice(5, 10).map(row => row.id));
	});

	it('shows the total and every export on the page in the embed', async () => {
		const embed = embedOf(await history('0'));

		expect(embed.title).toBe('Export History (12 total)');
		for (const row of exports.slice(0, 5)) {
			expect(embed.description).toContain(`\`${row.id}\``);
			expect(embed.description).toContain(`Guild ${row.guild_id} - #channel-${row.channel_id}`);
			expect(embed.description).toContain(`<t:${row.created_at}:D>`);
		}
	});

	it('falls back to Unknown for a guild or channel that no longer resolves', async () => {
		GetGuild.mockResolvedValue(null);
		GetChannel.mockResolvedValue(null);

		expect(embedOf(await history('0')).description).toContain('Unknown - #Unknown');
	});

	it('stays within Discord limits with 100-character guild and channel names', async () => {
		GetGuild.mockResolvedValue({ name: 'g'.repeat(100) });
		GetChannel.mockResolvedValue({ name: 'c'.repeat(100) });

		await history('0'); // ExpectValidResponse runs inside
	});
});

describe('/history', () => {
	async function command(): Promise<HandlerResult> {
		const interaction = makeInteraction({ userId: USER_ID });
		const result = await HistoryCommand.execute(interaction as never, client);
		await ExpectValidResponse(result, HistoryCommand);
		return result;
	}

	it('renders the first page', async () => {
		const result = await command();

		expect(offsetQueried()).toBe(0);
		expect(counter(result)).toBe('1 / 3');
	});

	it('renders NoExports with no exports', async () => {
		exports = [];
		expect(embedOf(await command()).description).toMatch(/no export history/);
	});
});
