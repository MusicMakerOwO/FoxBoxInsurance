import { describe, it, expect, vi, beforeEach } from 'vitest';
import { IClient } from '../../../Client.js';
import { COLOR, EMOJI } from '../../../Utils/Constants.js';
import { ButtonHandler } from '../../../Typings/HandlerTypes.js';
import { ExpectValidResponse, HandlerResult, buttonsOf, embedOf, makeClient, screen } from '../Helpers.js';
import { IMPORT_ID, OTHER_GUILD_ID, ResetStore, importSnapshot, interaction, storedSnapshot } from './Fixtures.js';

/**
 * `snapshot-manage` (RenderSnapshotManage) - one snapshot or import, with View / Download / Pin and
 * Back / Restore / Delete. `restore-safety` renders the same screen as a reply.
 */

vi.mock('../../../Database.js', () => ({ Database: { query: vi.fn() } }));
vi.mock('../../../CRUD/Snapshots.js', async (importOriginal) => ({ ...await importOriginal<object>(), ...(await import('./Fixtures.js')).SnapshotsMock }));
vi.mock('../../../CRUD/SnapshotImports.js', async () => (await import('./Fixtures.js')).ImportsMock);

const SnapshotManage = (await import('../../../Buttons/Snapshots/Manage.js')).default;
const RestoreSafety = (await import('../../../Buttons/Restore/Safety.js')).default;

let client: IClient;

beforeEach(async () => {
	vi.clearAllMocks();
	ResetStore();
	client = await makeClient();
});

async function manage(id: string, handler: ButtonHandler = SnapshotManage): Promise<HandlerResult> {
	const result = await handler.execute(interaction(), client, [ id ]);
	await ExpectValidResponse(result, handler);
	return result;
}

function button(result: HandlerResult, label: string) {
	const found = buttonsOf(result).find(b => b.label === label);
	if (!found) throw new Error(`no '${label}' button`);
	return found;
}

function ExpectNotFound(result: HandlerResult) {
	expect(embedOf(result)).toMatchObject({ color: COLOR.ERROR, title: 'Snapshot Not Found' });
	expect(screen(result).components).toEqual([]);
}

describe('not found', () => {
	it('an unknown id -> Snapshot Not Found with components cleared', async () => {
		ExpectNotFound(await manage('5'));
	});

	it("another guild's stored snapshot -> not found", async () => {
		storedSnapshot(5, { guild_id: BigInt(OTHER_GUILD_ID) });
		ExpectNotFound(await manage('5'));
	});

	it('an expired import whose id starts with digits never resolves to a stored snapshot', async () => {
		importSnapshot(IMPORT_ID, { expires_at: Date.now() - 1 });
		storedSnapshot(2345);
		ExpectNotFound(await manage(IMPORT_ID));
	});

	it("restore-safety refuses another guild's safety snapshot", async () => {
		storedSnapshot(5, { guild_id: BigInt(OTHER_GUILD_ID) });
		ExpectNotFound(await manage('5', RestoreSafety));
	});
});

describe('import', () => {
	it('shows the Import title, counts and expiry', async () => {
		const data = importSnapshot(IMPORT_ID, { channels: 4, roles: 5, bans: 6 });
		const embed = embedOf(await manage(IMPORT_ID));

		expect(embed.title).toBe(`Import #${IMPORT_ID}`);
		expect(embed.description).toContain('Channels: 4');
		expect(embed.description).toContain('Roles: 5');
		expect(embed.description).toContain('Bans: 6');
		expect(embed.description).toContain(`Expires <t:${Math.floor(data.expires_at / 1000)}:R>`);
	});

	it('View opens the import viewer; Download, Pin and Delete are disabled', async () => {
		importSnapshot();
		const result = await manage(IMPORT_ID);

		expect(button(result, 'View')).toMatchObject({ custom_id: `import-view_${IMPORT_ID}` });
		expect(button(result, 'Download').disabled).toBe(true);
		expect(button(result, 'Pin').disabled).toBe(true);
		expect(button(result, 'Delete').disabled).toBe(true);
		expect(button(result, 'Restore').disabled).toBeFalsy();
	});
});

describe('stored snapshot', () => {
	it('shows the created date and counts', async () => {
		const snapshot = storedSnapshot(5, { channels: 3, roles: 2, bans: 1 });
		const embed = embedOf(await manage('5'));

		expect(embed.title).toBe('Snapshot #5');
		expect(embed.description).toContain('Channels: 3');
		expect(embed.description).toContain(`Created at <t:${Math.floor(snapshot.created_at.getTime() / 1000)}:d>`);
		expect(embed.description).not.toContain(EMOJI.PIN);
	});

	it('unpinned: Pin label, Delete enabled', async () => {
		storedSnapshot(5);
		const result = await manage('5');

		expect(button(result, 'Pin')).toMatchObject({ custom_id: 'snapshot-pin_5' });
		expect(button(result, 'Delete')).toMatchObject({ custom_id: 'snapshot-delete_5', disabled: false });
		expect(button(result, 'Download')).toMatchObject({ custom_id: 'snapshot-export_5', disabled: false });
		expect(button(result, 'View')).toMatchObject({ custom_id: 'snapshot-view_5' });
	});

	it('pinned: Unpin label, Delete disabled, pinned marker', async () => {
		storedSnapshot(5, { pinned: true });
		const result = await manage('5');

		expect(button(result, 'Unpin')).toMatchObject({ custom_id: 'snapshot-pin_5' });
		expect(button(result, 'Delete').disabled).toBe(true);
		expect(embedOf(result).description).toContain(`${EMOJI.PIN} Pinned`);
	});

	it('Restore -> restore-options_<id>, back -> snapshot-list', async () => {
		storedSnapshot(5);
		const result = await manage('5');

		expect(button(result, 'Restore')).toMatchObject({ custom_id: 'restore-options_5' });
		expect(buttonsOf(result).some(b => 'custom_id' in b && b.custom_id === 'snapshot-list')).toBe(true);
	});

	it('restore-safety renders the same screen for its own guild', async () => {
		storedSnapshot(5);
		expect(await manage('5', RestoreSafety)).toEqual(await manage('5'));
	});
});
