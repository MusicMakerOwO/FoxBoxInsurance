import { describe, it, expect, vi, beforeEach } from 'vitest';
import { IClient } from '../../../Client.js';
import { COLOR } from '../../../Utils/Constants.js';
import { ExpectValidResponse, HandlerResult, customIDs, embedOf, makeClient, screen } from '../Helpers.js';
import { IMPORT_ID, OTHER_GUILD_ID, ResetStore, importSnapshot, interaction } from '../Snapshots/Fixtures.js';

/**
 * `import-view_<id>` - the hub into the three import viewers. Reached from the warning prompt while
 * the import is staged, and from snapshot-manage once it's listed; Back follows whichever it is.
 */

vi.mock('../../../Database.js', () => ({ Database: { query: vi.fn() } }));
vi.mock('../../../CRUD/Snapshots.js', async (importOriginal) => ({ ...await importOriginal<object>(), ...(await import('../Snapshots/Fixtures.js')).SnapshotsMock }));
vi.mock('../../../CRUD/SnapshotImports.js', async () => (await import('../Snapshots/Fixtures.js')).ImportsMock);

const ImportView = (await import('../../../Buttons/Imports/View.js')).default;

let client: IClient;

beforeEach(async () => {
	vi.clearAllMocks();
	ResetStore();
	client = await makeClient();
});

async function view(...args: string[]): Promise<HandlerResult> {
	const result = await ImportView.execute(interaction(), client, args.length ? args : [ IMPORT_ID ]);
	await ExpectValidResponse(result, ImportView);
	return result;
}

const VIEWERS = [ `import-view-channels_${IMPORT_ID}`, `import-view-roles_${IMPORT_ID}`, `import-view-bans_${IMPORT_ID}` ];

describe('not found -> Import Not Found, components cleared', () => {
	function ExpectNotFound(result: HandlerResult) {
		expect(embedOf(result)).toMatchObject({ color: COLOR.ERROR, title: 'Import Not Found' });
		expect(screen(result).components).toEqual([]);
	}

	it('unknown', async () => ExpectNotFound(await view()));

	it('expired', async () => {
		importSnapshot(IMPORT_ID, { expires_at: Date.now() - 1 });
		ExpectNotFound(await view());
	});

	it("another guild's", async () => {
		importSnapshot(IMPORT_ID, { guildID: OTHER_GUILD_ID });
		importSnapshot(IMPORT_ID, { guildID: OTHER_GUILD_ID, staged: true });
		ExpectNotFound(await view());
	});
});

it('staged: Back returns to the warning prompt', async () => {
	importSnapshot(IMPORT_ID, { staged: true });
	expect(customIDs(await view())).toEqual([ `import_${IMPORT_ID}`, ...VIEWERS ]);
});

it('listed: Back returns to snapshot-manage', async () => {
	importSnapshot(IMPORT_ID);
	expect(customIDs(await view())).toEqual([ `snapshot-manage_${IMPORT_ID}`, ...VIEWERS ]);
});

it("an old `_1` (managed) custom_id still renders - the flag is ignored", async () => {
	importSnapshot(IMPORT_ID);
	expect(customIDs(await view(IMPORT_ID, '1'))).toEqual([ `snapshot-manage_${IMPORT_ID}`, ...VIEWERS ]);
});

it('keeps the embed above - only the buttons change', async () => {
	importSnapshot(IMPORT_ID);
	expect(screen(await view()).embeds).toBeUndefined();
});
