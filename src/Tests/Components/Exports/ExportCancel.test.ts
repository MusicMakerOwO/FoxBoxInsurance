import { describe, it, expect, vi, beforeEach } from 'vitest';
import { IClient } from '../../../Client.js';
import { ExpectValidResponse, HandlerResult, customIDs, makeClient, screen } from '../Helpers.js';
import { OPEN_GATES, SESSION_KEY, dispatch, interaction, seedSession } from './Fixtures.js';

/** `export-cancel` asks first; `export-cancel_confirm` deletes the export menu and its session */

const { query } = vi.hoisted(() => ({ query: vi.fn(() => { throw new Error('unexpected query'); }) }));
vi.mock('../../../Database.js', () => ({ Database: { query } }));

// The dispatcher reads handlers off the singleton, so the singleton *is* the test client
const { clientRef, GetUser, GetGuild } = vi.hoisted(() => ({ clientRef: {} as Record<string, unknown>, GetUser: vi.fn(), GetGuild: vi.fn() }));
vi.mock('../../../Client.js', () => ({ client: clientRef }));
vi.mock('../../../CRUD/Users.js', () => ({ GetUser }));
vi.mock('../../../CRUD/Guilds.js', () => ({ GetGuild }));

const ExportCancel = (await import('../../../Buttons/Exports/ExportCancel.js')).default;

let client: IClient;

beforeEach(async () => {
	vi.clearAllMocks();
	GetUser.mockResolvedValue(OPEN_GATES.user);
	GetGuild.mockResolvedValue(OPEN_GATES.guild);
	client = Object.assign(clientRef, await makeClient()) as unknown as IClient;
	client.exportCache.cache.clear();
});

async function cancel(args: string[] = []): Promise<HandlerResult> {
	const result = await ExportCancel.execute(interaction(), client, args);
	await ExpectValidResponse(result, ExportCancel);
	return result;
}

describe('export-cancel', () => {
	it('asks first, offering Delete and a way back to the export menu', async () => {
		const result = await cancel();

		expect(screen(result).delete).toBeUndefined();
		expect(customIDs(result)).toEqual([ 'export-cancel_confirm', 'export-main' ]);
	});

	// Bug: `!!args[0]` treated any argument as confirmation
	it.each([ [ 'yes' ], [ '1' ], [ 'Confirm' ] ])('asks again for any argument other than confirm (%s)', async (arg) => {
		seedSession(client);
		const result = await cancel([ arg ]);

		expect(screen(result).delete).toBeUndefined();
		expect(customIDs(result)).toEqual([ 'export-cancel_confirm', 'export-main' ]);
		expect(client.exportCache.has(SESSION_KEY)).toBe(true);
	});

	it('confirm deletes the message', async () => {
		seedSession(client);
		expect(await cancel([ 'confirm' ])).toEqual({ delete: true });
	});

	// A stale export-main / export-finish left in another message must not resurrect a cancelled export
	it('confirm drops the session', async () => {
		seedSession(client);
		await cancel([ 'confirm' ]);

		expect(client.exportCache.has(SESSION_KEY)).toBe(false);
	});

	it('[dispatcher] confirm deletes the message and nothing edits it afterwards', async () => {
		seedSession(client);
		const sent = await dispatch('button', 'export-cancel_confirm');

		expect(sent.deferUpdate).toHaveBeenCalledOnce();
		expect(sent.deleteReply).toHaveBeenCalledOnce();
		expect(sent.editReply).not.toHaveBeenCalled();
		expect(sent.reply).not.toHaveBeenCalled();
	});
});
