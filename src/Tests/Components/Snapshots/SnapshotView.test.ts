import { describe, it, expect, vi, beforeEach } from 'vitest';
import { IClient } from '../../../Client.js';
import { COLOR } from '../../../Utils/Constants.js';
import { ExpectValidResponse, HandlerResult, customIDs, embedOf, makeClient, screen } from '../Helpers.js';
import { IMPORT_ID, OTHER_GUILD_ID, ResetStore, SnapshotsMock, importSnapshot, interaction, storedSnapshot } from './Fixtures.js';

/**
 * `snapshot-view_<id>` - the hub between snapshot-manage and the three snapshot viewers. It keeps the
 * manage embed and swaps the buttons, so it only sets `components`.
 */

vi.mock('../../../Database.js', () => ({ Database: { query: vi.fn() } }));
vi.mock('../../../CRUD/Snapshots.js', async (importOriginal) => ({ ...await importOriginal<object>(), ...(await import('./Fixtures.js')).SnapshotsMock }));
vi.mock('../../../CRUD/SnapshotImports.js', async () => (await import('./Fixtures.js')).ImportsMock);

const SnapshotView = (await import('../../../Buttons/Snapshots/View.js')).default;

let client: IClient;

beforeEach(async () => {
	vi.clearAllMocks();
	ResetStore();
	client = await makeClient();
});

async function view(id: string): Promise<HandlerResult> {
	const result = await SnapshotView.execute(interaction(), client, [ id ]);
	await ExpectValidResponse(result, SnapshotView);
	return result;
}

function ExpectNotFound(result: HandlerResult) {
	expect(embedOf(result)).toMatchObject({ color: COLOR.ERROR, title: 'Snapshot Not Found' });
	expect(screen(result).components).toEqual([]);
}

it('renders Back and the three viewer buttons for the id', async () => {
	storedSnapshot(5);
	const result = await view('5');

	expect(customIDs(result)).toEqual([
		'snapshot-manage_5',
		'snapshot-view-channels_5',
		'snapshot-view-roles_5',
		'snapshot-view-bans_5'
	]);
	expect(screen(result).embeds).toBeUndefined(); // the manage embed stays above
});

describe('malformed ids throw before any lookup', () => {
	it.each([ 'abc', '0', '-5', '5abc', '', IMPORT_ID ])('%j', async (id) => {
		await expect(SnapshotView.execute(interaction(), client, [ id ])).rejects.toThrow('Invalid snapshot ID');
		expect(SnapshotsMock.GetSnapshot).not.toHaveBeenCalled();
	});
});

describe('not found', () => {
	it('an unknown id', async () => {
		ExpectNotFound(await view('5'));
	});

	it("another guild's stored snapshot", async () => {
		storedSnapshot(5, { guild_id: BigInt(OTHER_GUILD_ID) });
		ExpectNotFound(await view('5'));
	});

	it('an import id is never read as the stored snapshot its digits name', async () => {
		importSnapshot(IMPORT_ID, { expires_at: Date.now() - 1 });
		storedSnapshot(2345);
		await expect(SnapshotView.execute(interaction(), client, [ IMPORT_ID ])).rejects.toThrow('Invalid snapshot ID');
	});
});
