import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { IClient } from '../../../Client.js';
import { ExpectValidResponse, HandlerResult, customIDs, embedOf, makeClient, makeInteraction } from '../Helpers.js';

/**
 * `bot-info` - version, counts and uptime, with a button into `global-stats`. `/info` delegates to it.
 *
 * The two counts go through the self-releasing `Database.query`. A `getConnection` call would mean a
 * connection is held by hand again (it leaked when a count threw), so it's asserted never made.
 */

const { query, getConnection } = vi.hoisted(() => ({
	query        : vi.fn(),
	getConnection: vi.fn()
}));
vi.mock('../../../Database.js', () => ({ Database: { query, getConnection } }));

const Info = (await import('../../../Buttons/Info.js')).default;
const InfoCommand = (await import('../../../Commands/Info.js')).default;
const { LATEST_VERSION } = await import('../../../Commands/Changelog.js');

let counts: { Guilds: bigint, Messages: bigint };
/** Set to make the matching count reject */
let failing: 'Guilds' | 'Messages' | null;
let client: IClient;

function makeGuild(channels: number, memberCount: number) {
	return { channels: { cache: { size: channels } }, memberCount };
}

beforeEach(async () => {
	vi.clearAllMocks();
	counts = { Guilds: 12n, Messages: 3456n };
	failing = null;

	query.mockImplementation(async (sql: string) => {
		const table = /FROM (\w+)/.exec(sql)![1] as keyof typeof counts;
		if (!(table in counts)) throw new Error(`unexpected query: ${sql}`);
		if (failing === table) throw new Error(`${table} failed`);
		return [{ count: counts[table] }];
	});

	client = {
		...await makeClient(),
		guilds: { cache: new Map([ [ '1', makeGuild(10, 100) ], [ '2', makeGuild(5, 23) ] ]) },
		user  : { displayAvatarURL: () => 'https://cdn.example/avatar.png' }
	} as unknown as IClient;

	vi.spyOn(process, 'uptime').mockReturnValue(0);
});

afterEach(() => {
	vi.restoreAllMocks();
});

async function info(): Promise<HandlerResult> {
	const result = await Info.execute(makeInteraction(), client, []);
	await ExpectValidResponse(result, Info);
	return result;
}

describe('bot-info', () => {
	it('shows the server, channel, user and message counts', async () => {
		const description = embedOf(await info()).description;

		expect(description).toContain('**Servers** : 12');
		expect(description).toContain('**Channels** : 15');
		expect(description).toContain('**Users** : 123');
		expect(description).toContain('**Messages** : 3456');
	});

	it('shows the latest changelog version', async () => {
		expect(embedOf(await info()).description).toContain(`**Version** : ${LATEST_VERSION}`);
	});

	it('is titled with the bot\'s name and carries its avatar', async () => {
		const embed = embedOf(await info());

		expect(embed.title).toBe('Fox Box Insurance');
		expect(embed.thumbnail?.url).toBe('https://cdn.example/avatar.png');
	});

	it('renders with no guilds cached', async () => {
		(client.guilds.cache as unknown as Map<string, unknown>).clear();
		const description = embedOf(await info()).description;

		expect(description).toContain('**Channels** : 0');
		expect(description).toContain('**Users** : 0');
	});

	it.each([
		[ 0             , '0d 0h 0m 0s'      ],
		[ 59.9          , '0d 0h 0m 59s'     ],
		[ 60            , '0d 0h 1m 0s'      ],
		[ 3599          , '0d 0h 59m 59s'    ],
		[ 3600          , '0d 1h 0m 0s'      ],
		[ 86_399        , '0d 23h 59m 59s'   ],
		[ 86_400        , '1d 0h 0m 0s'      ],
		[ 90_061        , '1d 1h 1m 1s'      ],
		[ 86_400 * 400  , '400d 0h 0m 0s'    ]
	])('renders %d seconds of uptime as %s', async (seconds, label) => {
		vi.mocked(process.uptime).mockReturnValue(seconds);
		expect(embedOf(await info()).description).toContain(`**Uptime** : \`${label}\``);
	});

	it('Message Stats leads to global-stats', async () => {
		expect(customIDs(await info())).toEqual([ 'global-stats' ]);
	});

	// Bug: a hand-released connection with no try/finally leaked whenever a count threw
	it.each([ 'Guilds', 'Messages' ] as const)('holds no connection when the %s count throws', async (table) => {
		failing = table;

		await expect(Info.execute(makeInteraction(), client, [])).rejects.toThrow(`${table} failed`);
		expect(getConnection).not.toHaveBeenCalled();
	});

	it('never checks out a connection of its own', async () => {
		await info();
		expect(getConnection).not.toHaveBeenCalled();
	});
});

describe('/info', () => {
	it('renders the same screen as the button', async () => {
		const result = await InfoCommand.execute(makeInteraction() as never, client);
		await ExpectValidResponse(result, InfoCommand);

		expect(result).toEqual(await info());
	});
});
