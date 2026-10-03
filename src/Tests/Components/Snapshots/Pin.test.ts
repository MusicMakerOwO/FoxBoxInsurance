import { describe, it, expect, vi, beforeEach } from 'vitest';
import { IClient } from '../../../Client.js';
import { COLOR } from '../../../Utils/Constants.js';
import { ExpectValidResponse, HandlerResult, buttonsOf, customIDs, embedOf, makeClient, screen } from '../Helpers.js';
import {
	IMPORT_ID,
	MAX_SNAPSHOTS,
	OTHER_GUILD_ID,
	ResetStore,
	SnapshotsMock,
	importSnapshot,
	interaction,
	store,
	storedSnapshot
} from './Fixtures.js';

/**
 * `snapshot-pin_<id>` asks, `snapshot-pin_<id>_confirm` pins and `snapshot-pin_<id>_confirm_1` unpins.
 * Pins are capped at MaxSnapshotsForGuild, which only ever limits *pinning*.
 */

vi.mock('../../../Database.js', () => ({ Database: { query: vi.fn() } }));
vi.mock('../../../CRUD/Snapshots.js', async (importOriginal) => ({ ...await importOriginal<object>(), ...(await import('./Fixtures.js')).SnapshotsMock }));
vi.mock('../../../CRUD/SnapshotImports.js', async () => (await import('./Fixtures.js')).ImportsMock);

const SnapshotPin = (await import('../../../Buttons/Snapshots/Pin.js')).default;

let client: IClient;

beforeEach(async () => {
	vi.clearAllMocks();
	ResetStore();
	client = await makeClient();
});

async function pin(...args: string[]): Promise<HandlerResult> {
	const result = await SnapshotPin.execute(interaction(), client, args);
	await ExpectValidResponse(result, SnapshotPin);
	return result;
}

/** Fills every pin slot with snapshots 101.. so the cap is reached */
function fillPins(): void {
	for (let i = 0; i < MAX_SNAPSHOTS; i++) storedSnapshot(101 + i, { pinned: true });
}

function ExpectFull(result: HandlerResult) {
	expect(embedOf(result)).toMatchObject({ color: COLOR.ERROR, title: 'Snapshots Full' });
	expect(screen(result).components).toEqual([]);
}

function ExpectNotFound(result: HandlerResult) {
	expect(embedOf(result).color).toBe(COLOR.ERROR);
	expect(embedOf(result).description).toContain('does not exist');
	expect(screen(result).components).toEqual([]);
}

describe('prompt', () => {
	it('unpinned -> Pin prompt with confirm and Cancel back to manage', async () => {
		storedSnapshot(5);
		const result = await pin('5');

		expect(embedOf(result).title).toBe('Pin Snapshot');
		expect(buttonsOf(result).map(b => b.label)).toEqual([ 'Pin Snapshot', 'Cancel' ]);
		expect(customIDs(result)).toEqual([ 'snapshot-pin_5_confirm', 'snapshot-manage_5' ]);
		expect(SnapshotsMock.SetSnapshotPinStatus).not.toHaveBeenCalled();
	});

	it('pinned -> Unpin prompt', async () => {
		storedSnapshot(5, { pinned: true });
		const result = await pin('5');

		expect(embedOf(result).title).toBe('Unpin Snapshot');
		expect(buttonsOf(result).map(b => b.label)).toEqual([ 'Unpin Snapshot', 'Cancel' ]);
		expect(customIDs(result)).toEqual([ 'snapshot-pin_5_confirm_1', 'snapshot-manage_5' ]);
	});

	it('at max pins, pinning another is blocked', async () => {
		fillPins();
		storedSnapshot(5);
		ExpectFull(await pin('5'));
	});

	it('at max pins, unpinning still works', async () => {
		fillPins();
		expect(embedOf(await pin('101')).title).toBe('Unpin Snapshot');
	});

	it('an unknown id -> not found with the manage buttons cleared', async () => {
		ExpectNotFound(await pin('5'));
	});

	it("another guild's snapshot -> not found", async () => {
		storedSnapshot(5, { guild_id: BigInt(OTHER_GUILD_ID) });
		ExpectNotFound(await pin('5'));
	});
});

describe('confirm', () => {
	it('_confirm pins, with Back to manage', async () => {
		storedSnapshot(5);
		const result = await pin('5', 'confirm');

		expect(store.snapshots.get(5)!.pinned).toBe(1);
		expect(embedOf(result).description).toContain('pinned successfully');
		expect(customIDs(result)).toEqual([ 'snapshot-manage_5' ]);
	});

	it('_confirm_1 unpins, with Back to manage', async () => {
		storedSnapshot(5, { pinned: true });
		const result = await pin('5', 'confirm', '1');

		expect(store.snapshots.get(5)!.pinned).toBe(0);
		expect(embedOf(result).description).toContain('unpinned successfully');
		expect(customIDs(result)).toEqual([ 'snapshot-manage_5' ]);
	});

	it('_confirm_1 still unpins at max pins', async () => {
		fillPins();
		await pin('101', 'confirm', '1');
		expect(store.snapshots.get(101)!.pinned).toBe(0);
	});

	it("another guild's snapshot -> not found, nothing changed", async () => {
		storedSnapshot(5, { guild_id: BigInt(OTHER_GUILD_ID) });

		ExpectNotFound(await pin('5', 'confirm'));
		ExpectNotFound(await pin('5', 'confirm', '1'));
		expect(SnapshotsMock.SetSnapshotPinStatus).not.toHaveBeenCalled();
		expect(store.snapshots.get(5)!.pinned).toBe(0);
	});

	it('deleted between the prompt and confirm -> not found', async () => {
		storedSnapshot(5);
		await pin('5');
		store.snapshots.delete(5);

		ExpectNotFound(await pin('5', 'confirm'));
	});

	it('slots filling up between the prompt and confirm -> Snapshots Full, not a throw', async () => {
		storedSnapshot(5);
		expect(embedOf(await pin('5')).title).toBe('Pin Snapshot');
		fillPins();

		ExpectFull(await pin('5', 'confirm'));
		expect(store.snapshots.get(5)!.pinned).toBe(0);
	});
});

describe('malformed ids', () => {
	it.each([ [ 'abc' ], [ '0' ], [ '-1' ], [ IMPORT_ID ] ])('%j throws before any lookup', async (id) => {
		storedSnapshot(2345);
		importSnapshot();

		await expect(SnapshotPin.execute(interaction(), client, [ id ])).rejects.toThrow('Invalid snapshot ID');
		await expect(SnapshotPin.execute(interaction(), client, [ id, 'confirm' ])).rejects.toThrow('Invalid snapshot ID');
		expect(SnapshotsMock.ListSnapshotsForGuild).not.toHaveBeenCalled();
		expect(SnapshotsMock.SetSnapshotPinStatus).not.toHaveBeenCalled();
	});
});
