import { describe, it, expect, vi, beforeEach } from 'vitest';
import { IClient } from '../../../Client.js';
import { COLOR } from '../../../Utils/Constants.js';
import { ExpectValidResponse, HandlerResult, buttonsOf, embedOf, makeClient, screen } from '../Helpers.js';
import { IMPORT_EXPIRATION, IMPORT_ID, OTHER_GUILD_ID, ResetStore, importSnapshot, interaction } from '../Snapshots/Fixtures.js';

/**
 * `import_<id>` - the "can contain harmful data" warning shown after `/snapshot import`, with View,
 * Cancel and Import. It only exists for a staged upload; once listed or cancelled the prompt is done.
 */

vi.mock('../../../Database.js', () => ({ Database: { query: vi.fn() } }));
vi.mock('../../../CRUD/Snapshots.js', async (importOriginal) => ({ ...await importOriginal<object>(), ...(await import('../Snapshots/Fixtures.js')).SnapshotsMock }));
vi.mock('../../../CRUD/SnapshotImports.js', async () => (await import('../Snapshots/Fixtures.js')).ImportsMock);

const ImportPrompt = (await import('../../../Buttons/Imports/Import.js')).default;

let client: IClient;

beforeEach(async () => {
	vi.clearAllMocks();
	ResetStore();
	client = await makeClient();
});

async function prompt(id: string = IMPORT_ID): Promise<HandlerResult> {
	const result = await ImportPrompt.execute(interaction(), client, [ id ]);
	await ExpectValidResponse(result, ImportPrompt);
	return result;
}

function ExpectNotFound(result: HandlerResult) {
	expect(embedOf(result)).toMatchObject({ color: COLOR.ERROR, title: 'Import Not Found' });
	expect(screen(result).components).toEqual([]);
}

describe('not found', () => {
	it('an unknown id', async () => {
		ExpectNotFound(await prompt());
	});

	it('an expired staged import', async () => {
		importSnapshot(IMPORT_ID, { staged: true, expires_at: Date.now() - 1 });
		ExpectNotFound(await prompt());
	});

	it('an import that is already listed - the prompt is done', async () => {
		importSnapshot(IMPORT_ID);
		ExpectNotFound(await prompt());
	});

	it("another guild's staged import", async () => {
		importSnapshot(IMPORT_ID, { staged: true, guildID: OTHER_GUILD_ID });
		ExpectNotFound(await prompt());
	});
});

describe('staged', () => {
	beforeEach(() => void importSnapshot(IMPORT_ID, { staged: true }));

	it('warns, and says how long the import stays listed', async () => {
		const embed = embedOf(await prompt());
		expect(embed.title).toBe('Import Snapshot?');
		expect(embed.description).toContain('can contain harmful data');
		expect(embed.description).toContain(`${IMPORT_EXPIRATION / 60_000} minutes`);
	});

	it('View -> import-view, Cancel -> import-cancel, Import -> import-confirm', async () => {
		const result = await prompt();
		const byLabel = Object.fromEntries(buttonsOf(result).map(b => [ b.label, 'custom_id' in b ? b.custom_id : null ]));

		expect(byLabel).toEqual({
			View  : `import-view_${IMPORT_ID}`,
			Cancel: `import-cancel_${IMPORT_ID}`,
			Import: `import-confirm_${IMPORT_ID}`
		});
	});
});
