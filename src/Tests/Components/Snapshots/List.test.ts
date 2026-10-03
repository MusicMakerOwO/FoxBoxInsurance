import { describe, it, expect, vi, beforeEach } from 'vitest';
import { IClient } from '../../../Client.js';
import { COLOR, EMOJI, SNAPSHOT_TYPE } from '../../../Utils/Constants.js';
import { ExpectValidResponse, HandlerResult, buttonsOf, embedOf, makeClient, screen, selectsOf } from '../Helpers.js';
import { GUILD_ID, MAX_SNAPSHOTS, ResetStore, importSnapshot, interaction, store, storedSnapshot } from './Fixtures.js';

/**
 * `snapshot-list` - imports first, then stored snapshots newest -> oldest, 5 per page, with a select
 * into `snapshot-view` and a nav row once there's more than one page.
 */

vi.mock('../../../Database.js', () => ({ Database: { query: vi.fn() } }));
vi.mock('../../../CRUD/Snapshots.js', async (importOriginal) => ({ ...await importOriginal<object>(), ...(await import('./Fixtures.js')).SnapshotsMock }));
vi.mock('../../../CRUD/SnapshotImports.js', async () => (await import('./Fixtures.js')).ImportsMock);

const SnapshotList = (await import('../../../Buttons/Snapshots/List.js')).default;

let client: IClient;

beforeEach(async () => {
	vi.clearAllMocks();
	ResetStore();
	client = await makeClient();
});

async function list(page?: string): Promise<HandlerResult> {
	const result = await SnapshotList.execute(interaction(), client, page === undefined ? [] : [ page ]);
	await ExpectValidResponse(result, SnapshotList);
	return result;
}

/** `count` stored snapshots with ids 1..count */
function seed(count: number): void {
	for (let id = 1; id <= count; id++) storedSnapshot(id);
}

function optionValues(result: HandlerResult): string[] {
	return selectsOf(result)[0].options.map(option => option.value);
}

function counter(result: HandlerResult): string | undefined {
	return buttonsOf(result).find(b => 'custom_id' in b && b.custom_id === 'null')?.label;
}

function navButton(result: HandlerResult, emoji: string) {
	const found = buttonsOf(result).find(b => b.emoji?.name === emoji);
	if (!found) throw new Error(`no ${emoji} button`);
	return found;
}

describe('empty', () => {
	it('no imports and no snapshots -> No Snapshots, components cleared', async () => {
		const result = await list();
		expect(embedOf(result)).toMatchObject({ color: COLOR.ERROR, title: 'No Snapshots' });
		expect(screen(result).components).toEqual([]);
	});

	it('an expired import alone still counts as empty', async () => {
		importSnapshot('ABCD-EFGH-JKLM-NPQR', { expires_at: Date.now() - 1 });
		expect(embedOf(await list()).title).toBe('No Snapshots');
	});
});

describe('ordering', () => {
	it('imports first, then stored snapshots newest -> oldest', async () => {
		seed(3);
		importSnapshot('ABCD-EFGH-JKLM-NPQR');
		expect(optionValues(await list())).toEqual([ 'ABCD-EFGH-JKLM-NPQR', '3', '2', '1' ]);
	});

	it("only lists this guild's snapshots", async () => {
		storedSnapshot(1);
		storedSnapshot(2, { guild_id: 1n });
		expect(optionValues(await list())).toEqual([ '1' ]);
	});
});

describe('paging', () => {
	it.each([
		[ 4, 1 ], [ 5, 1 ], [ 6, 2 ], [ 10, 2 ], [ 11, 3 ]
	])('`last` with %d items lands on page %d', async (count, pages) => {
		seed(count);
		const result = await list('last');

		const expectedOnLast = count - (pages - 1) * 5;
		expect(optionValues(result)).toHaveLength(expectedOnLast);
		if (count > 5) expect(counter(result)).toBe(`Page ${pages} / ${pages}`);
	});

	it.each([ [ '99' ], [ '2' ] ])('page %s past the end clamps to the last page', async (page) => {
		seed(7);
		const result = await list(page);
		expect(optionValues(result)).toEqual([ '2', '1' ]);
		expect(counter(result)).toBe('Page 2 / 2');
	});

	it('a negative page clamps to the first page', async () => {
		seed(7);
		const result = await list('-1');
		expect(optionValues(result)).toEqual([ '7', '6', '5', '4', '3' ]);
		expect(counter(result)).toBe('Page 1 / 2');
	});

	it.each([ [ undefined ], [ 'first' ], [ 'abc' ] ])('%j -> first page', async (page) => {
		seed(7);
		expect(optionValues(await list(page))).toEqual([ '7', '6', '5', '4', '3' ]);
	});

	it('no nav row at 5 items; the select holds exactly the visible items', async () => {
		seed(5);
		const result = await list();
		expect(screen(result).components).toHaveLength(1);
		expect(optionValues(result)).toEqual([ '5', '4', '3', '2', '1' ]);
	});

	it('a nav row past 5 items, disabled at each end', async () => {
		seed(11);

		const first = await list('first');
		expect(screen(first).components).toHaveLength(2);
		expect(navButton(first, EMOJI.FIRST_PAGE).disabled).toBe(true);
		expect(navButton(first, EMOJI.PREVIOUS_PAGE).disabled).toBe(true);
		expect(navButton(first, EMOJI.NEXT_PAGE)).toMatchObject({ custom_id: 'snapshot-list_1', disabled: false });

		const middle = await list('1');
		expect(navButton(middle, EMOJI.PREVIOUS_PAGE)).toMatchObject({ custom_id: 'snapshot-list_0', disabled: false });
		expect(navButton(middle, EMOJI.NEXT_PAGE)).toMatchObject({ custom_id: 'snapshot-list_2', disabled: false });

		const last = await list('last');
		expect(navButton(last, EMOJI.NEXT_PAGE).disabled).toBe(true);
		expect(navButton(last, EMOJI.LAST_PAGE).disabled).toBe(true);
	});
});

describe('embed', () => {
	it('the slot counter counts stored snapshots only, not imports', async () => {
		seed(3);
		importSnapshot('ABCD-EFGH-JKLM-NPQR');
		importSnapshot('BCDE-FGHJ-KLMN-PQRS');
		expect(embedOf(await list()).title).toBe(`Snapshot List (used 3/${MAX_SNAPSHOTS} slots)`);
	});

	it('the imports header shows only when the page starts with an import', async () => {
		seed(5);
		importSnapshot('ABCD-EFGH-JKLM-NPQR');
		importSnapshot('BCDE-FGHJ-KLMN-PQRS');

		expect(embedOf(await list('0')).description).toContain('You have 2 imports available');
		expect(embedOf(await list('1')).description).not.toContain('imports available');
	});

	it('the pending-deletion warning shows only on flagged snapshots', async () => {
		seed(2);
		store.queued.add(1);
		const description = embedOf(await list()).description!;

		const [ newer, older ] = description.split('Snapshot #').slice(1);
		expect(description.match(/pending deletion/g)).toHaveLength(1);
		// The warning is rendered above the snapshot it belongs to
		expect(newer).toContain('pending deletion');
		expect(older).not.toContain('pending deletion');
	});

	it('pinned snapshots use the pin emoji in both the embed and the option', async () => {
		storedSnapshot(1);
		storedSnapshot(2, { pinned: true });
		const result = await list();

		expect(embedOf(result).description).toContain(`${EMOJI.PIN} **Snapshot #2**`);
		expect(embedOf(result).description).toContain(`${EMOJI.SNAPSHOT} **Snapshot #1**`);
		const options = selectsOf(result)[0].options;
		expect(options.find(o => o.value === '2')!.emoji).toEqual({ name: EMOJI.PIN });
		expect(options.find(o => o.value === '1')!.emoji).toEqual({ name: EMOJI.SNAPSHOT });
	});

	it('shows the snapshot type', async () => {
		storedSnapshot(1, { type: SNAPSHOT_TYPE.AUTOMATIC });
		expect(embedOf(await list()).description).toContain('`AUTOMATIC`');
	});

	it('the daily snapshot window is the UTC hour SnapshotServers runs this guild in', async () => {
		seed(1);
		const hour = Number(BigInt(GUILD_ID) % 24n);
		expect(embedOf(await list()).description).toContain(`between <t:${hour * 3600}:t> and <t:${(hour + 1) * 3600}:t>`);
	});
});
