import { describe, it, expect, vi, beforeEach } from 'vitest';
import { IClient } from '../../../Client.js';
import { COLOR, EMOJI } from '../../../Utils/Constants.js';
import { ButtonHandler } from '../../../Typings/HandlerTypes.js';
import { ExpectValidResponse, HandlerResult, buttonsOf, customIDs, embedOf, makeClient, screen } from '../Helpers.js';
import { IMPORT_ID, OTHER_GUILD_ID, ResetStore, importSnapshot, interaction, storedSnapshot } from './Fixtures.js';

/**
 * The six list viewers - `snapshot-view-{channels,roles,bans}_<id>_<page>` and
 * `import-view-{channels,roles,bans}_<id>_<page>`. They share Buttons/Snapshots/View/Render.ts, so
 * every case runs for all six: 25 per page, a nav row only past one page, First / Last carrying a
 * trailing `_` so they never collide with Prev / Next.
 *
 * Import viewers intentionally carry no guild feature (they are reachable from a listed import in
 * snapshot-manage) - that's pinned in Handlers/Registry.test.ts.
 */

vi.mock('../../../Database.js', () => ({ Database: { query: vi.fn() } }));
vi.mock('../../../CRUD/Snapshots.js', async (importOriginal) => ({ ...await importOriginal<object>(), ...(await import('./Fixtures.js')).SnapshotsMock }));
vi.mock('../../../CRUD/SnapshotImports.js', async () => (await import('./Fixtures.js')).ImportsMock);

const Handlers = {
	'snapshot-view-channels': (await import('../../../Buttons/Snapshots/View/Channels.js')).default,
	'snapshot-view-roles'   : (await import('../../../Buttons/Snapshots/View/Roles.js')).default,
	'snapshot-view-bans'    : (await import('../../../Buttons/Snapshots/View/Bans.js')).default,
	'import-view-channels'  : (await import('../../../Buttons/Imports/View/Channels.js')).default,
	'import-view-roles'     : (await import('../../../Buttons/Imports/View/Roles.js')).default,
	'import-view-bans'      : (await import('../../../Buttons/Imports/View/Bans.js')).default
};

type Kind = 'channels' | 'roles' | 'bans';
type Source = 'snapshot' | 'import';
type Entries = number | object[];

const KIND_TITLE: Record<Kind, string> = { channels: 'Channels', roles: 'Roles', bans: 'Bans' };
const SNAPSHOT_ID = '5';

type Row = {
	customID: keyof typeof Handlers;
	kind    : Kind;
	source  : Source;
	id      : string;
	label   : string;
	/** Seeds this guild's snapshot / listed import with `entries` of the row's kind (0 of the others) */
	seed    : (entries: Entries) => void;
	back    : string;
};

function Row(source: Source, kind: Kind): Row {
	const counts = { channels: 0, roles: 0, bans: 0 };
	return source === 'snapshot'
		? {
			customID: `snapshot-view-${kind}`, kind, source,
			id   : SNAPSHOT_ID,
			label: `Snapshot #${SNAPSHOT_ID}`,
			seed : entries => void storedSnapshot(Number(SNAPSHOT_ID), { ...counts, [kind]: entries }),
			back : `snapshot-manage_${SNAPSHOT_ID}`
		}
		: {
			customID: `import-view-${kind}`, kind, source,
			id   : IMPORT_ID,
			label: `Import #${IMPORT_ID}`,
			seed : entries => void importSnapshot(IMPORT_ID, { ...counts, [kind]: entries }),
			back : `snapshot-manage_${IMPORT_ID}`
		};
}

const ROWS: Row[] = [
	Row('snapshot', 'channels'), Row('snapshot', 'roles'), Row('snapshot', 'bans'),
	Row('import', 'channels'), Row('import', 'roles'), Row('import', 'bans')
];

let client: IClient;

beforeEach(async () => {
	vi.clearAllMocks();
	ResetStore();
	client = await makeClient();
});

function handlerOf(row: Row): ButtonHandler {
	return Handlers[row.customID];
}

async function view(row: Row, ...args: string[]): Promise<HandlerResult> {
	const handler = handlerOf(row);
	const result = await handler.execute(interaction(), client, [ row.id, ...args ]);
	await ExpectValidResponse(result, handler);
	return result;
}

/** Presses a rendered button, splitting its custom_id the way GlobalHandler does */
async function press(row: Row, customID: string): Promise<HandlerResult> {
	const [ prefix, ...args ] = customID.split('_');
	expect(prefix).toBe(row.customID);
	const handler = handlerOf(row);
	const result = await handler.execute(interaction(), client, args);
	await ExpectValidResponse(result, handler);
	return result;
}

function lines(result: HandlerResult): string[] {
	return embedOf(result).description!.split('\n');
}

function counter(result: HandlerResult): string | undefined {
	return buttonsOf(result).find(b => 'custom_id' in b && b.custom_id === 'null')?.label;
}

function navButton(result: HandlerResult, emoji: string): string {
	const found = buttonsOf(result).find(b => b.emoji?.name === emoji);
	if (!found || !('custom_id' in found)) throw new Error(`no ${emoji} button`);
	return found.custom_id;
}

describe.each(ROWS)('$customID', (row) => {
	describe('not found', () => {
		const title = row.source === 'snapshot' ? 'Snapshot Not Found' : 'Import Not Found';

		function ExpectNotFound(result: HandlerResult) {
			expect(embedOf(result)).toMatchObject({ color: COLOR.ERROR, title });
			expect(screen(result).components).toEqual([]);
		}

		it('unknown id -> not found, components cleared', async () => {
			ExpectNotFound(await view(row));
		});

		if (row.source === 'snapshot') {
			it("another guild's stored snapshot -> not found", async () => {
				storedSnapshot(Number(SNAPSHOT_ID), { guild_id: BigInt(OTHER_GUILD_ID) });
				ExpectNotFound(await view(row));
			});

			it('an import id throws instead of resolving the stored snapshot its digits name', async () => {
				storedSnapshot(2345);
				await expect(handlerOf(row).execute(interaction(), client, [ IMPORT_ID ])).rejects.toThrow('Invalid snapshot ID');
			});
		} else {
			it('an expired import -> not found', async () => {
				importSnapshot(IMPORT_ID, { expires_at: Date.now() - 1 });
				ExpectNotFound(await view(row));
			});

			it("another guild's import -> not found", async () => {
				importSnapshot(IMPORT_ID, { guildID: OTHER_GUILD_ID });
				importSnapshot(IMPORT_ID, { guildID: OTHER_GUILD_ID, staged: true });
				ExpectNotFound(await view(row));
			});
		}
	});

	it('an empty list says so, with only Back', async () => {
		row.seed(0);
		const result = await view(row);

		expect(embedOf(result).description).toBe(`No ${row.kind} found in this ${row.source} :(`);
		expect(embedOf(result).footer?.text).toBe(`Total ${KIND_TITLE[row.kind]}: 0`);
		expect(customIDs(result)).toEqual([ row.back ]);
	});

	it('titles and totals name the kind being viewed', async () => {
		row.seed(3);
		const embed = embedOf(await view(row));

		expect(embed.title).toBe(`${row.label} (${KIND_TITLE[row.kind]})`);
		expect(embed.footer?.text).toBe(`Total ${KIND_TITLE[row.kind]}: 3`);
	});

	describe('paging', () => {
		it('25 items fit one page - no nav row', async () => {
			row.seed(25);
			const result = await view(row);

			expect(lines(result)).toHaveLength(25);
			expect(screen(result).components).toHaveLength(1);
			expect(customIDs(result)).toEqual([ row.back ]);
		});

		it('26 items -> 25 on the first page, 1 on the second, with nav', async () => {
			row.seed(26);
			const first = await view(row);
			expect(lines(first)).toHaveLength(25);
			expect(screen(first).components).toHaveLength(2);
			expect(counter(first)).toBe('Page 1 / 2');

			const second = await press(row, navButton(first, EMOJI.NEXT_PAGE));
			expect(lines(second)).toHaveLength(1);
			expect(counter(second)).toBe('Page 2 / 2');
		});

		it.each([
			[ 26, 1 ],
			[ 50, 1 ],
			[ 51, 2 ],
			[ 75, 2 ]
		])('Last targets the real last page for %i items (page %i)', async (count, lastPage) => {
			row.seed(count);
			const first = await view(row);
			const last = navButton(first, EMOJI.LAST_PAGE);
			expect(last).toBe(`${row.customID}_${row.id}_${lastPage}_`);

			const result = await press(row, last);
			expect(counter(result)).toBe(`Page ${lastPage + 1} / ${lastPage + 1}`);
			expect(lines(result)).toHaveLength(count - lastPage * 25);
		});

		it('First / Prev are disabled on the first page, Next / Last on the last', async () => {
			row.seed(30);
			const disabled = (result: HandlerResult) => buttonsOf(result)
				.filter(b => b.disabled && b.emoji)
				.map(b => b.emoji!.name);

			expect(disabled(await view(row, '0'))).toEqual([ EMOJI.FIRST_PAGE, EMOJI.PREVIOUS_PAGE ]);
			expect(disabled(await view(row, '1'))).toEqual([ EMOJI.NEXT_PAGE, EMOJI.LAST_PAGE ]);
		});

		it('a page past the end clamps to the last page', async () => {
			row.seed(30);
			const result = await view(row, '9');
			expect(counter(result)).toBe('Page 2 / 2');
			expect(lines(result)).toHaveLength(5);
		});

		it.each([ 'abc', '-1', '' ])('page %j -> the first page', async (page) => {
			row.seed(30);
			const result = await view(row, page);
			expect(counter(result)).toBe('Page 1 / 2');
			expect(lines(result)).toHaveLength(25);
		});

		it('every button on every page is valid - walking the whole list by Next', async () => {
			row.seed(80);
			let result = await view(row);
			const seen = [ counter(result) ];

			for (let i = 0; i < 3; i++) {
				result = await press(row, navButton(result, EMOJI.NEXT_PAGE));
				seen.push(counter(result));
			}

			expect(seen).toEqual([ 'Page 1 / 4', 'Page 2 / 4', 'Page 3 / 4', 'Page 4 / 4' ]);
			await press(row, navButton(result, EMOJI.FIRST_PAGE));
			await press(row, navButton(result, EMOJI.PREVIOUS_PAGE));
		});
	});

	it('Back goes to the manage screen', async () => {
		row.seed(3);
		const result = await view(row);
		const back = buttonsOf(result).find(b => b.label === 'Back');
		expect(back).toMatchObject({ custom_id: row.back });
	});

	if (row.source === 'import') {
		it('a staged import (still behind the warning) goes Back to the prompt', async () => {
			importSnapshot(IMPORT_ID, { staged: true });
			const result = await view(row);
			const back = buttonsOf(result).find(b => b.label === 'Back');
			expect(back).toMatchObject({ custom_id: `import_${IMPORT_ID}` });
		});
	}
});

//////////////////
// Formatting - per kind, for both sources
//////////////////

function RowsOf(kind: Kind): Row[] {
	return ROWS.filter(row => row.kind === kind);
}

describe.each(RowsOf('channels'))('$customID formatting', (row) => {
	it('escapes markdown in names', async () => {
		row.seed([ { name: 'a_*b*_c' } ]);
		expect(lines(await view(row))).toEqual([ '#a\\_\\*b\\*\\_c' ]);
	});

	it('worst case: 25 names that double when escaped stay within the embed limit', async () => {
		row.seed(Array.from({ length: 25 }, () => ({ name: '_'.repeat(100) })));
		// ExpectValidResponse (inside view) enforces the 4096 char description
		expect(lines(await view(row))).toHaveLength(25);
	});
});

describe.each(RowsOf('roles'))('$customID formatting', (row) => {
	it('managed roles get the bot emoji, others none', async () => {
		row.seed([ { name: 'Bot Role', managed_by: 1n }, { name: 'Member', managed_by: null } ]);
		expect(lines(await view(row))).toEqual([ `${EMOJI.BOT} @Bot Role`, ' @Member' ]);
	});

	it('escapes markdown in names', async () => {
		row.seed([ { name: '**bold**' } ]);
		expect(lines(await view(row))).toEqual([ ' @\\*\\*bold\\*\\*' ]);
	});

	it('worst case: 25 managed roles with names that double when escaped stay within the limit', async () => {
		row.seed(Array.from({ length: 25 }, () => ({ name: '*'.repeat(100), managed_by: 1n })));
		expect(lines(await view(row))).toHaveLength(25);
	});
});

describe.each(RowsOf('bans'))('$customID formatting', (row) => {
	it('shows the mention, id and reason', async () => {
		row.seed([ { id: 42n, reason: 'spam' } ]);
		expect(lines(await view(row))).toEqual([ '<@42> (42) - spam' ]);
	});

	it.each([ null, '', '   ' ])("reason %j -> 'No reason provided'", async (reason) => {
		row.seed([ { id: 42n, reason } ]);
		expect(lines(await view(row))).toEqual([ '<@42> (42) - No reason provided' ]);
	});

	it("cuts reasons over 50 chars to 50 with '...'", async () => {
		row.seed([ { id: 42n, reason: 'x'.repeat(60) } ]);
		expect(lines(await view(row))).toEqual([ `<@42> (42) - ${'x'.repeat(47)}...` ]);
	});

	it('keeps a multi-line reason on its own line and escapes markdown', async () => {
		row.seed([ { id: 42n, reason: '> quoted\n**loud**' } ]);
		expect(lines(await view(row))).toEqual([ '<@42> (42) - \\> quoted \\*\\*loud\\*\\*' ]);
	});

	it('worst case: 25 snowflake bans with max-length reasons stay within the limit', async () => {
		row.seed(Array.from({ length: 25 }, (_, i) => ({ id: 900000000000000000n + BigInt(i), reason: '*'.repeat(512) })));
		expect(lines(await view(row))).toHaveLength(25);
	});
});
