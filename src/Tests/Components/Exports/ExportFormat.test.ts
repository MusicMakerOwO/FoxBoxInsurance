import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { IClient } from '../../../Client.js';
import { FORMAT } from '../../../Utils/Constants.js';
import { ExpectValidResponse, HandlerResult, buttonsOf, makeClient, screen } from '../Helpers.js';
import { SESSION_KEY, TIMEOUT_TEXT, cacheKeys, interaction, seedSession } from './Fixtures.js';

/** `export-format` - the format picker, and `export-format_<format>` storing the pick */

const { query } = vi.hoisted(() => ({ query: vi.fn(() => { throw new Error('unexpected query'); }) }));
vi.mock('../../../Database.js', () => ({ Database: { query } }));

const ExportFormat = (await import('../../../Buttons/Exports/ExportFormat.js')).default;

let client: IClient;

beforeEach(async () => {
	client = await makeClient();
});

afterEach(() => {
	vi.useRealTimers();
});

async function pick(args: string[] = []): Promise<HandlerResult> {
	const result = await ExportFormat.execute(interaction(), client, args);
	await ExpectValidResponse(result, ExportFormat);
	return result;
}

function formatButtons(result: HandlerResult) {
	return buttonsOf(result).filter(button => 'custom_id' in button && button.custom_id.startsWith('export-format_'));
}

describe('export-format', () => {
	it('reports an expired session', async () => {
		const result = await pick([ String(FORMAT.TEXT) ]);
		expect(screen(result)).toMatchObject({ embeds: [{ description: TIMEOUT_TEXT }], components: [] });
	});

	it('renders the picker without changing anything when given no format', async () => {
		const session = seedSession(client, { format: FORMAT.JSON });
		const result = await pick();

		expect(session.format).toBe(FORMAT.JSON);
		expect(formatButtons(result)).toHaveLength(3);
	});

	// Bug: the pick was also written under `export_<guild>_<channel>_<user>`, a key nothing reads
	it('stores the pick under the session key and nowhere else', async () => {
		seedSession(client, { format: FORMAT.HTML });
		await pick([ String(FORMAT.TEXT) ]);

		expect(cacheKeys(client)).toEqual([ SESSION_KEY ]);
		expect(client.exportCache.get(SESSION_KEY)!.format).toBe(FORMAT.TEXT);
	});

	it('refreshes the session TTL when a format is picked', async () => {
		vi.useFakeTimers();
		seedSession(client);
		const before = client.exportCache.cache.get(SESSION_KEY)!.expiryTime;

		vi.advanceTimersByTime(5 * 60_000);
		await pick([ String(FORMAT.JSON) ]);

		expect(client.exportCache.cache.get(SESSION_KEY)!.expiryTime).toBe(before + 5 * 60_000);
	});

	// Bug: `export-format_9` stored 9 as the format, and the export later failed on it. CSV (8) is
	// deprecated and errors when generated, so it is refused the same way.
	it.each([ [ '9' ], [ String(FORMAT.CSV) ], [ 'abc' ], [ '-1' ] ])('ignores a format outside the offered ones (%s)', async (arg) => {
		const session = seedSession(client, { format: FORMAT.HTML });
		const result = await pick([ arg ]);

		expect(session.format).toBe(FORMAT.HTML);
		expect(formatButtons(result)).toHaveLength(3);
	});

	it.each([ FORMAT.TEXT, FORMAT.JSON, FORMAT.HTML ])('marks format %i as current: SUCCESS + disabled, the others SECONDARY', async (format) => {
		seedSession(client);
		const buttons = formatButtons(await pick([ String(format) ]));

		for (const button of buttons) {
			const current = 'custom_id' in button && button.custom_id === `export-format_${format}`;
			expect(button.style).toBe(current ? 3 : 2);
			expect(!!button.disabled).toBe(current);
		}
		expect(buttons.filter(button => button.disabled)).toHaveLength(1);
	});
});
