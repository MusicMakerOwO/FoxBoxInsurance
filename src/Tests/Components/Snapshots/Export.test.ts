import { describe, it, expect, vi, beforeEach } from 'vitest';
import { IClient } from '../../../Client.js';
import { COLOR } from '../../../Utils/Constants.js';
import { ExpectValidResponse, HandlerResult, buttonsOf, embedOf, makeClient, screen } from '../Helpers.js';
import {
	IMPORT_ID,
	OTHER_GUILD_ID,
	ResetStore,
	SnapshotsMock,
	USER_ID,
	importSnapshot,
	interaction,
	storedSnapshot
} from './Fixtures.js';

/**
 * `snapshot-export_<id>` - serialises a stored snapshot, uploads it for a single download, and links it.
 * Moved from `Tests/Buttons/SnapshotExport.test.ts`.
 */

vi.mock('../../../Database.js', () => ({ Database: { query: vi.fn() } }));
vi.mock('../../../CRUD/Snapshots.js', async (importOriginal) => ({ ...await importOriginal<object>(), ...(await import('./Fixtures.js')).SnapshotsMock }));
vi.mock('../../../CRUD/SnapshotImports.js', async () => (await import('./Fixtures.js')).ImportsMock);

const { UploadCDN } = vi.hoisted(() => ({ UploadCDN: vi.fn() }));
vi.mock('../../../Utils/UploadCDN.js', () => ({ UploadCDN }));

vi.mock('../../../Utils/Snapshots/Imports/Parse.js', async (importOriginal) => ({ ...await importOriginal<object>(), SnapshotParsers: { 2: vi.fn() } }));

const SnapshotExport = (await import('../../../Buttons/Snapshots/Export.js')).default;

const LOOKUP = 'lookup-id';
const SERIALIZED = '{"id":"EXPT-0000"}';

let client: IClient;

beforeEach(async () => {
	vi.clearAllMocks();
	ResetStore();
	UploadCDN.mockResolvedValue(LOOKUP);
	SnapshotsMock.ExportSnapshot.mockResolvedValue({ data: { id: 'EXPT-0000', version: 2 }, serialized: SERIALIZED });
	client = await makeClient();
});

async function exportSnapshot(id: string): Promise<HandlerResult> {
	const result = await SnapshotExport.execute(interaction(), client, [ id ]);
	await ExpectValidResponse(result, SnapshotExport);
	return result;
}

function ExpectNotFound(result: HandlerResult) {
	expect(embedOf(result)).toMatchObject({ color: COLOR.ERROR, title: 'Snapshot Not Found' });
	expect(screen(result).components).toEqual([]);
	expect(SnapshotsMock.ExportSnapshot).not.toHaveBeenCalled();
	expect(UploadCDN).not.toHaveBeenCalled();
}

describe('not found', () => {
	it('an unknown id -> not found with the manage buttons cleared', async () => {
		ExpectNotFound(await exportSnapshot('5'));
	});

	it('refuses to export a snapshot belonging to a different guild', async () => {
		storedSnapshot(5, { guild_id: BigInt(OTHER_GUILD_ID) });
		ExpectNotFound(await exportSnapshot('5'));
	});

	it('an import id never exports the stored snapshot its digits name', async () => {
		storedSnapshot(2345);
		importSnapshot();
		await expect(SnapshotExport.execute(interaction(), client, [ IMPORT_ID ])).rejects.toThrow('Invalid snapshot ID');
		expect(SnapshotsMock.ExportSnapshot).not.toHaveBeenCalled();
	});
});

describe('export', () => {
	it('exports a snapshot that belongs to the requesting guild', async () => {
		storedSnapshot(5);
		const result = await exportSnapshot('5');

		expect(SnapshotsMock.ExportSnapshot).toHaveBeenCalledWith(5, BigInt(USER_ID));
		expect(embedOf(result).description).toContain('EXPT-0000');
	});

	it('the CDN filename uses the snapshot id, single download', async () => {
		storedSnapshot(5);
		await exportSnapshot('5');
		expect(UploadCDN).toHaveBeenCalledExactlyOnceWith('snapshot-5.json', Buffer.from(SERIALIZED, 'utf8'), 1);
	});

	it('the Download link and the embed point at the same lookup', async () => {
		storedSnapshot(5);
		const result = await exportSnapshot('5');
		const url = `https://cdn.notfbi.dev/download/${LOOKUP}`;

		expect(buttonsOf(result)).toEqual([ expect.objectContaining({ style: 5, label: 'Download', url }) ]);
		expect(embedOf(result).description).toContain(`(${url})`);
	});
});
