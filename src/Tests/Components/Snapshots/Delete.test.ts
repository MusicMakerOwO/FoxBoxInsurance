import { describe, it, expect, vi, beforeEach } from 'vitest';
import { IClient } from '../../../Client.js';
import { COLOR } from '../../../Utils/Constants.js';
import { ExpectValidResponse, HandlerResult, customIDs, embedOf, makeClient, screen } from '../Helpers.js';
import {
	IMPORT_ID,
	OTHER_GUILD_ID,
	OWNER_ID,
	ResetStore,
	SnapshotsMock,
	importSnapshot,
	interaction,
	store,
	storedSnapshot
} from './Fixtures.js';

/**
 * `snapshot-delete_<id>` asks, `snapshot-delete_<id>_confirm` deletes. Any Administrator may delete
 * (the gate is the handler's `permissions`); pinned snapshots never can be.
 */

vi.mock('../../../Database.js', () => ({ Database: { query: vi.fn() } }));
vi.mock('../../../CRUD/Snapshots.js', async (importOriginal) => ({ ...await importOriginal<object>(), ...(await import('./Fixtures.js')).SnapshotsMock }));
vi.mock('../../../CRUD/SnapshotImports.js', async () => (await import('./Fixtures.js')).ImportsMock);

const SnapshotDelete = (await import('../../../Buttons/Snapshots/Delete.js')).default;

let client: IClient;

beforeEach(async () => {
	vi.clearAllMocks();
	ResetStore();
	client = await makeClient();
});

async function remove(args: string[], options: Parameters<typeof interaction>[0] = {}): Promise<HandlerResult> {
	const result = await SnapshotDelete.execute(interaction(options), client, args);
	await ExpectValidResponse(result, SnapshotDelete);
	return result;
}

function ExpectNotFound(result: HandlerResult) {
	expect(embedOf(result).color).toBe(COLOR.ERROR);
	expect(embedOf(result).description).toContain('no longer exists');
	expect(screen(result).components).toEqual([]);
}

function ExpectPinnedRefusal(result: HandlerResult) {
	expect(embedOf(result).description).toContain('pinned and cannot be deleted');
	expect(screen(result).components).toEqual([]);
}

describe('who can delete', () => {
	it('any Administrator, not just the owner', async () => {
		storedSnapshot(5);
		expect(embedOf(await remove([ '5' ])).title).toBe('Deleting snapshot #5');
		await remove([ '5', 'confirm' ]);
		expect(store.snapshots.has(5)).toBe(false);
	});

	it('the owner too', async () => {
		storedSnapshot(5);
		expect(embedOf(await remove([ '5' ], { userId: OWNER_ID })).title).toBe('Deleting snapshot #5');
	});
});

describe('not found', () => {
	it('an unknown id -> not found with components cleared', async () => {
		ExpectNotFound(await remove([ '5' ]));
		ExpectNotFound(await remove([ '5', 'confirm' ]));
	});

	it("another guild's snapshot -> not found, nothing deleted", async () => {
		storedSnapshot(5, { guild_id: BigInt(OTHER_GUILD_ID) });

		ExpectNotFound(await remove([ '5' ]));
		ExpectNotFound(await remove([ '5', 'confirm' ]));
		expect(SnapshotsMock.DeleteSnapshot).not.toHaveBeenCalled();
		expect(store.snapshots.has(5)).toBe(true);
	});

	it.each([ [ 'abc' ], [ '' ], [ IMPORT_ID ] ])('%j -> not found, DeleteSnapshot never called', async (id) => {
		storedSnapshot(2345);
		importSnapshot();

		ExpectNotFound(await remove([ id, 'confirm' ]));
		expect(SnapshotsMock.DeleteSnapshot).not.toHaveBeenCalled();
		expect(store.snapshots.has(2345)).toBe(true);
	});
});

describe('pinned', () => {
	it('refused on the prompt and on confirm, nothing deleted', async () => {
		storedSnapshot(5, { pinned: true });

		ExpectPinnedRefusal(await remove([ '5' ]));
		ExpectPinnedRefusal(await remove([ '5', 'confirm' ]));
		expect(SnapshotsMock.DeleteSnapshot).not.toHaveBeenCalled();
	});
});

describe('prompt', () => {
	it('shows counts and the created date; Confirm -> _confirm, back -> manage', async () => {
		const snapshot = storedSnapshot(5, { channels: 3, roles: 2, bans: 1 });
		const result = await remove([ '5' ]);
		const description = embedOf(result).description!;

		expect(description).toContain('Channels: 3');
		expect(description).toContain('Roles: 2');
		expect(description).toContain('Bans: 1');
		expect(description).toContain(`<t:${Math.floor(snapshot.created_at.getTime() / 1000)}:d>`);
		expect(customIDs(result)).toEqual([ 'snapshot-delete_5_confirm', 'snapshot-manage_5' ]);
		expect(SnapshotsMock.DeleteSnapshot).not.toHaveBeenCalled();
	});

	it('any other second arg asks again', async () => {
		storedSnapshot(5);
		expect(embedOf(await remove([ '5', 'yes' ])).title).toBe('Deleting snapshot #5');
		expect(SnapshotsMock.DeleteSnapshot).not.toHaveBeenCalled();
	});
});

describe('confirm', () => {
	it('deletes exactly once and offers Back to the list', async () => {
		storedSnapshot(5);
		const result = await remove([ '5', 'confirm' ]);

		expect(SnapshotsMock.DeleteSnapshot).toHaveBeenCalledTimes(1);
		expect(SnapshotsMock.DeleteSnapshot).toHaveBeenCalledWith(5);
		expect(embedOf(result).description).toContain('has been deleted');
		expect(customIDs(result)).toEqual([ 'snapshot-list' ]);
	});

	it('pinned between the check and the delete -> the pinned refusal', async () => {
		storedSnapshot(5);
		SnapshotsMock.DeleteSnapshot.mockImplementationOnce(async (id: number) => {
			store.snapshots.get(id)!.pinned = 1;
			throw new Error('Cannot delete a pinned snapshot');
		});

		ExpectPinnedRefusal(await remove([ '5', 'confirm' ]));
	});

	it('deleted between the check and the delete -> not found', async () => {
		storedSnapshot(5);
		SnapshotsMock.DeleteSnapshot.mockImplementationOnce(async (id: number) => {
			store.snapshots.delete(id);
			throw new Error('Snapshot not found');
		});

		ExpectNotFound(await remove([ '5', 'confirm' ]));
	});

	it('any other failure is rethrown for the dispatcher to report', async () => {
		storedSnapshot(5);
		SnapshotsMock.DeleteSnapshot.mockRejectedValueOnce(new Error('connection lost'));

		await expect(SnapshotDelete.execute(interaction(), client, [ '5', 'confirm' ])).rejects.toThrow('connection lost');
	});
});
