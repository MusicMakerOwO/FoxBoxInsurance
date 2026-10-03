import { describe, it, expect, vi, beforeEach } from 'vitest';
import { IClient } from '../../../Client.js';
import { FORMAT } from '../../../Utils/Constants.js';
import { ExpectValidResponse, HandlerResult, buttonsOf, embedOf, makeClient, screen } from '../Helpers.js';
import { CHANNEL_ID, GUILD_ID, TIMEOUT_TEXT, USER_ID, interaction, seedSession } from './Fixtures.js';

/**
 * `export-finish` - flushes pending assets, generates the file, uploads it, records it, and hands
 * back a single-use download link. Every external step is stubbed; what's under test is the order,
 * the error handling, and that the screen and the row agree.
 */

const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('../../../Database.js', () => ({ Database: { query } }));

const { order, DownloadAssets, UploadFiles, ExportChannel, UploadCDN, Log } = vi.hoisted(() => {
	const order: string[] = [];
	const step = (name: string) => vi.fn(async () => { order.push(name); });
	return {
		order,
		DownloadAssets: step('DownloadAssets'),
		UploadFiles   : step('UploadFiles'),
		ExportChannel : vi.fn(),
		UploadCDN     : vi.fn(),
		Log           : vi.fn()
	};
});
vi.mock('../../../Utils/Processing/Images.js', async (importOriginal) => ({ ...await importOriginal<object>(), DownloadAssets }));
vi.mock('../../../Utils/Tasks/UploadFiles.js', async (importOriginal) => ({ ...await importOriginal<object>(), UploadFiles }));
vi.mock('../../../Utils/Parsers/Export.js', async (importOriginal) => ({ ...await importOriginal<object>(), ExportChannel }));
vi.mock('../../../Utils/UploadCDN.js', () => ({ UploadCDN }));
vi.mock('../../../Utils/Log.js', async (importOriginal) => ({ ...await importOriginal<object>(), Log }));

const ExportFinish = (await import('../../../Buttons/Exports/ExportFinish.js')).default;

const FILE = {
	id  : 'ABCD-EFGH',
	name: 'export.html',
	hash: [ 'sha256', 'deadbeef' ] as [ 'sha256', string ],
	data: Buffer.alloc(2048)
};
const LOOKUP = 'lookup-123';

let client: IClient;

beforeEach(async () => {
	vi.clearAllMocks();
	order.length = 0;
	ExportChannel.mockImplementation(async () => { order.push('ExportChannel'); return FILE; });
	UploadCDN.mockResolvedValue(LOOKUP);
	query.mockResolvedValue({ affectedRows: 1 });
	client = await makeClient();
});

async function finish(): Promise<HandlerResult> {
	const result = await ExportFinish.execute(interaction(), client, []);
	await ExpectValidResponse(result, ExportFinish);
	return result;
}

function expectExportFailed(result: HandlerResult) {
	expect(screen(result)).toMatchObject({ embeds: [{ title: 'Export Failed' }], components: [] });
	expect(Log).toHaveBeenCalledWith('ERROR', expect.any(Error));
}

describe('export-finish', () => {
	it('reports an expired session without generating anything', async () => {
		const result = await finish();

		expect(screen(result)).toMatchObject({ embeds: [{ description: TIMEOUT_TEXT }], components: [] });
		expect(DownloadAssets).not.toHaveBeenCalled();
		expect(ExportChannel).not.toHaveBeenCalled();
	});

	it('flushes pending assets and files before generating', async () => {
		seedSession(client);
		await finish();

		expect(order).toEqual([ 'DownloadAssets', 'UploadFiles', 'ExportChannel' ]);
	});

	it('reports Export Failed and logs when generating throws', async () => {
		seedSession(client);
		ExportChannel.mockRejectedValue(new Error('generator broke'));

		expectExportFailed(await finish());
		expect(UploadCDN).not.toHaveBeenCalled();
		expect(query).not.toHaveBeenCalled();
	});

	// Bug: the upload sat outside the try/catch, so a CDN outage was an uncaught throw
	it('reports Export Failed and logs when the upload throws', async () => {
		seedSession(client);
		UploadCDN.mockRejectedValue(new Error('cdn down'));

		expectExportFailed(await finish());
		expect(query).not.toHaveBeenCalled();
	});

	// Bug: same for the Exports insert
	it('reports Export Failed and logs when recording the export throws', async () => {
		seedSession(client);
		query.mockRejectedValue(new Error('db down'));

		expectExportFailed(await finish());
	});

	// Export is disabled at 0 messages, but a stale or replayed click can still arrive
	it('refuses 0 messages with a plain follow-up, flushing and generating nothing', async () => {
		seedSession(client, { messageCount: 0 });
		const result = await finish();

		expect(screen(result).followUp).toBeDefined();
		expect(screen(result).followUp!.embeds![0].title).not.toBe('Export Failed');
		expect(DownloadAssets).not.toHaveBeenCalled();
		expect(ExportChannel).not.toHaveBeenCalled();
		expect(Log).not.toHaveBeenCalled();
	});

	it('uploads the file for a single download', async () => {
		seedSession(client);
		await finish();

		expect(UploadCDN).toHaveBeenCalledExactlyOnceWith(FILE.name, FILE.data, 1);
	});

	it('records exactly one Exports row with the file id, hash pair and lookup', async () => {
		seedSession(client, { format: FORMAT.JSON, messageCount: 321 });
		await finish();

		expect(query).toHaveBeenCalledOnce();
		const [ sql, params ] = query.mock.calls[0];
		expect(sql).toMatch(/INSERT INTO Exports/);
		expect(params).toEqual([ FILE.id, BigInt(GUILD_ID), BigInt(CHANNEL_ID), BigInt(USER_ID), 321, FORMAT.JSON, 'sha256', 'deadbeef', LOOKUP ]);
	});

	it('points the Download button and the embed at the same lookup', async () => {
		seedSession(client);
		const result = await finish();

		const [ download ] = buttonsOf(result);
		expect(download).toMatchObject({ style: 5, url: `https://cdn.notfbi.dev/download/${LOOKUP}` });
		expect(embedOf(result).description).toContain(`(https://cdn.notfbi.dev/download/${LOOKUP})`);
		expect(embedOf(result).description).toContain(`\`${FILE.id}\``);
	});
});
