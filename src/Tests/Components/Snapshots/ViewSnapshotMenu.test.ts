import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StringSelectMenuInteraction } from 'discord.js';
import { IClient } from '../../../Client.js';
import { ExpectValidResponse, makeClient } from '../Helpers.js';
import { GUILD_ID, IMPORT_ID, ResetStore, importSnapshot, interaction, storedSnapshot } from './Fixtures.js';

/**
 * The `snapshot-view` select on the list screen - hands the picked value to `snapshot-manage`.
 * Its gates matching the target's are asserted in `Handlers/Registry.test.ts`.
 */

vi.mock('../../../Database.js', () => ({ Database: { query: vi.fn() } }));
vi.mock('../../../CRUD/Snapshots.js', async (importOriginal) => ({ ...await importOriginal<object>(), ...(await import('./Fixtures.js')).SnapshotsMock }));
vi.mock('../../../CRUD/SnapshotImports.js', async () => (await import('./Fixtures.js')).ImportsMock);

const ViewSnapshot = (await import('../../../Menus/ViewSnapshot.js')).default;
const { RenderSnapshotManage } = await import('../../../Buttons/Snapshots/Manage.js');

let client: IClient;

beforeEach(async () => {
	vi.clearAllMocks();
	ResetStore();
	client = await makeClient();
});

describe('Menus/ViewSnapshot', () => {
	it.each([
		[ 'a stored snapshot', '5' ],
		[ 'an import', IMPORT_ID ]
	])('passes %s straight to snapshot-manage', async (_, value) => {
		storedSnapshot(5);
		importSnapshot();

		const result = await ViewSnapshot.execute(interaction({ kind: 'menu', values: [ value ] }) as unknown as StringSelectMenuInteraction, client, []);

		await ExpectValidResponse(result, ViewSnapshot);
		expect(result).toEqual(await RenderSnapshotManage(GUILD_ID, value));
	});
});
