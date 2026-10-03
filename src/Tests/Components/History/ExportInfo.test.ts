import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StringSelectMenuInteraction } from 'discord.js';
import { IClient } from '../../../Client.js';
import { SimpleMessageExport } from '../../../Typings/DatabaseTypes.js';
import { FORMAT, FORMAT_NAMES } from '../../../Utils/Constants.js';
import { ExpectValidResponse, HandlerResult, embedOf, makeClient, makeInteraction, screen } from '../Helpers.js';

/**
 * `exportInfo` - the select on the `history` screen. Answers with an ephemeral reply describing one
 * export, leaving the history screen as it was.
 *
 * One row lookup through the self-releasing `Database.query`; names come from the CRUD caches. A
 * `getConnection` call would mean a connection is held by hand again, so it's asserted never made.
 */

const { query, getConnection, GetGuild, GetChannel } = vi.hoisted(() => ({
	query        : vi.fn(),
	getConnection: vi.fn(),
	GetGuild     : vi.fn(),
	GetChannel   : vi.fn()
}));
vi.mock('../../../Database.js', () => ({ Database: { query, getConnection } }));
vi.mock('../../../CRUD/Guilds.js', async (importOriginal) => ({ ...await importOriginal<object>(), GetGuild }));
vi.mock('../../../CRUD/Channels.js', async (importOriginal) => ({ ...await importOriginal<object>(), GetChannel }));

const ExportInfo = (await import('../../../Menus/ExportInfo.js')).default;

const USER_ID  = '900000000000000005';
const EXPORT_ID = 'AAAA-BBBB-CCCC-DDDD';

function makeExport(overrides: Partial<SimpleMessageExport> = {}): SimpleMessageExport {
	return {
		id            : EXPORT_ID,
		guild_id      : 111n,
		channel_id    : 222n,
		user_id       : BigInt(USER_ID),
		message_count : 321,
		format        : FORMAT.JSON,
		hash          : 'deadbeef',
		hash_algorithm: 'sha256',
		lookup        : 'lookup-1',
		created_at    : 1_700_000_000,
		...overrides
	};
}

let client: IClient;

beforeEach(async () => {
	vi.clearAllMocks();
	query.mockResolvedValue([ makeExport() ]);
	GetGuild.mockResolvedValue({ id: 111n, name: 'Fox Den' });
	GetChannel.mockResolvedValue({ id: 222n, name: 'general' });
	client = await makeClient();
});

async function info(value = EXPORT_ID): Promise<HandlerResult> {
	const interaction = makeInteraction({ kind: 'menu', userId: USER_ID, values: [ value ] });
	const result = await ExportInfo.execute(interaction as unknown as StringSelectMenuInteraction, client, []);
	await ExpectValidResponse(result, ExportInfo);
	expect(getConnection).not.toHaveBeenCalled();
	return result;
}

describe('exportInfo', () => {
	it('looks up the picked export id', async () => {
		await info('WXYZ-WXYZ-WXYZ-WXYZ');

		expect(query).toHaveBeenCalledExactlyOnceWith(expect.stringMatching(/FROM Exports WHERE id = \?/), [ 'WXYZ-WXYZ-WXYZ-WXYZ' ]);
	});

	it('reports an unknown id with components cleared', async () => {
		query.mockResolvedValue([]);
		const result = await info();

		expect(screen(result)).toMatchObject({ embeds: [{ description: 'No export found with that ID' }], components: [] });
		expect(GetGuild).not.toHaveBeenCalled();
	});

	// Bug: the connection was checked out by hand with no try/finally, so a throw leaked it
	it('propagates a failed lookup without holding a connection', async () => {
		query.mockRejectedValue(new Error('db down'));
		const interaction = makeInteraction({ kind: 'menu', userId: USER_ID, values: [ EXPORT_ID ] });

		await expect(ExportInfo.execute(interaction as unknown as StringSelectMenuInteraction, client, [])).rejects.toThrow('db down');
		expect(getConnection).not.toHaveBeenCalled();
	});

	it('shows the guild and channel names alongside their ids', async () => {
		const description = embedOf(await info()).description;

		expect(GetGuild).toHaveBeenCalledWith(111n);
		expect(GetChannel).toHaveBeenCalledWith(222n);
		expect(description).toContain('**Guild** : Fox Den (111)');
		expect(description).toContain('**Channel** : #general (222)');
		expect(description).toContain(`**Export ID:** ${EXPORT_ID}`);
		expect(description).toContain('**Messages** : 321');
	});

	it('falls back to Unknown Guild / Unknown Channel when they no longer resolve', async () => {
		GetGuild.mockResolvedValue(null);
		GetChannel.mockResolvedValue(null);
		const description = embedOf(await info()).description;

		expect(description).toContain('**Guild** : Unknown Guild (111)');
		expect(description).toContain('**Channel** : #Unknown Channel (222)');
	});

	it.each(Object.values(FORMAT))('names format %i', async (format) => {
		query.mockResolvedValue([ makeExport({ format }) ]);
		expect(embedOf(await info()).description).toContain(`**Format** : ${FORMAT_NAMES[format]}`);
	});

	it('names an unrecognised format Unknown', async () => {
		query.mockResolvedValue([ makeExport({ format: 9 as SimpleMessageExport['format'] }) ]);
		expect(embedOf(await info()).description).toContain('**Format** : Unknown');
	});

	it('renders created_at as a floored Discord timestamp', async () => {
		query.mockResolvedValue([ makeExport({ created_at: 1_700_000_000.75 }) ]);
		expect(embedOf(await info()).description).toContain('**Created At** : <t:1700000000:f>');
	});

	// Intentional: no ownership check. Discord only accepts select values from the options it rendered,
	// and those come from the clicker's own history; the reply is ephemeral either way.
	it('describes an export by id regardless of who owns it', async () => {
		query.mockResolvedValue([ makeExport({ user_id: 900000000000000099n }) ]);
		expect(embedOf(await info()).description).toContain(`**Export ID:** ${EXPORT_ID}`);
	});
});
