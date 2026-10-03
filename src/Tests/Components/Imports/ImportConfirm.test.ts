import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { IClient } from '../../../Client.js';
import { COLOR } from '../../../Utils/Constants.js';
import { ExpectValidResponse, HandlerResult, customIDs, embedOf, makeClient, screen } from '../Helpers.js';
import { IMPORT_EXPIRATION, IMPORT_ID, ImportsMock, OTHER_GUILD_ID, ResetStore, importSnapshot, interaction, store } from '../Snapshots/Fixtures.js';

/**
 * `import-confirm_<id>` - lists a staged import for the next hour. Confirming one that's already
 * listed (the same file uploaded and confirmed twice) lists it again for a fresh hour.
 */

vi.mock('../../../Database.js', () => ({ Database: { query: vi.fn() } }));
vi.mock('../../../CRUD/Snapshots.js', async (importOriginal) => ({ ...await importOriginal<object>(), ...(await import('../Snapshots/Fixtures.js')).SnapshotsMock }));
vi.mock('../../../CRUD/SnapshotImports.js', async () => (await import('../Snapshots/Fixtures.js')).ImportsMock);

const ImportConfirm = (await import('../../../Buttons/Imports/Confirm.js')).default;

const NOW = new Date('2026-10-02T12:00:00Z').getTime();

let client: IClient;

beforeEach(async () => {
	vi.clearAllMocks();
	vi.useFakeTimers({ toFake: [ 'Date' ] });
	vi.setSystemTime(NOW);
	ResetStore();
	client = await makeClient();
});

afterEach(() => void vi.useRealTimers());

async function confirm(id: string = IMPORT_ID): Promise<HandlerResult> {
	const result = await ImportConfirm.execute(interaction(), client, [ id ]);
	await ExpectValidResponse(result, ImportConfirm);
	return result;
}

describe('not found -> Import Not Found, components cleared, nothing listed', () => {
	function ExpectNotFound(result: HandlerResult) {
		expect(embedOf(result)).toMatchObject({ color: COLOR.ERROR, title: 'Import Not Found' });
		expect(screen(result).components).toEqual([]);
		expect(ImportsMock.SaveImportForGuild).not.toHaveBeenCalled();
	}

	it('unknown', async () => ExpectNotFound(await confirm()));

	it('expired', async () => {
		importSnapshot(IMPORT_ID, { staged: true, expires_at: NOW - 1 });
		ExpectNotFound(await confirm());
	});

	it('staged by another guild', async () => {
		importSnapshot(IMPORT_ID, { staged: true, guildID: OTHER_GUILD_ID });
		ExpectNotFound(await confirm());
	});
});

describe('staged', () => {
	beforeEach(() => void importSnapshot(IMPORT_ID, { staged: true, expires_at: NOW + 10 * 60 * 1000 }));

	it('lists it and shows its real expiry', async () => {
		vi.setSystemTime(NOW + 5 * 60 * 1000); // read the warning for a while first
		const result = await confirm();

		const expiresAt = store.imports.get(interaction().guildId!)!.get(IMPORT_ID)!.expires_at;
		expect(expiresAt).toBe(NOW + 5 * 60 * 1000 + IMPORT_EXPIRATION);
		expect(embedOf(result)).toMatchObject({ color: COLOR.SUCCESS, title: 'Snapshot Imported' });
		expect(embedOf(result).description).toContain(`<t:${Math.floor(expiresAt / 1000)}:R>`);
	});

	it('View Snapshots -> snapshot-list', async () => {
		expect(customIDs(await confirm())).toEqual([ 'snapshot-list' ]);
	});
});

it('an already-listed import is listed again for a fresh hour', async () => {
	importSnapshot(IMPORT_ID, { expires_at: NOW + 10 * 60 * 1000 });
	const result = await confirm();

	expect(embedOf(result).title).toBe('Snapshot Imported');
	expect(embedOf(result).description).toContain(`<t:${Math.floor((NOW + IMPORT_EXPIRATION) / 1000)}:R>`);
});
