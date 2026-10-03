import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ChannelType } from 'discord.js';
import { IClient } from '../../../Client.js';
import { ButtonHandler, CommandHandler, ModalHandler } from '../../../Typings/HandlerTypes.js';
import { FORMAT, FORMAT_EMOJIS, FORMAT_NAMES } from '../../../Utils/Constants.js';
import { ExpectValidResponse, HandlerResult, buttonsOf, customIDs, embedOf, makeClient, screen } from '../Helpers.js';
import { CHANNEL_ID, OTHER_CHANNEL_ID, TIMEOUT_TEXT, interaction, seedSession } from './Fixtures.js';

/**
 * `export-main` - the hub every export screen returns to. Rendered directly by `/export`, both
 * export modals, and the Back buttons on the format picker and the cancel prompt.
 */

const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('../../../Database.js', () => ({ Database: { query } }));

const { CanMemberExportChannel, ProcessMessages } = vi.hoisted(() => ({
	CanMemberExportChannel: vi.fn(),
	ProcessMessages: vi.fn()
}));
vi.mock('../../../Services/ExportAccess.js', async (importOriginal) => ({ ...await importOriginal<object>(), CanMemberExportChannel }));
vi.mock('../../../Events/Messages.js', async (importOriginal) => ({ ...await importOriginal<object>(), ProcessMessages }));

const ExportMain = (await import('../../../Buttons/Exports/ExportMain.js')).default;
const ExportFormat = (await import('../../../Buttons/Exports/ExportFormat.js')).default;
const ExportCancel = (await import('../../../Buttons/Exports/ExportCancel.js')).default;
const ExportCommand = (await import('../../../Commands/Export.js')).default;
const ExportChannelModal = (await import('../../../Modals/ExportChannel.js')).default;
const ExportMessagesModal = (await import('../../../Modals/ExportMessages.js')).default;

let client: IClient;

beforeEach(async () => {
	vi.clearAllMocks();
	query.mockImplementation(async () => { throw new Error('unexpected query'); });
	CanMemberExportChannel.mockResolvedValue(true);
	client = await makeClient();
});

function run(handler: ButtonHandler, options: Parameters<typeof interaction>[0] = {}, args: string[] = []): Promise<HandlerResult> {
	return handler.execute(interaction(options), client, args);
}

async function render(options: Parameters<typeof interaction>[0] = {}): Promise<HandlerResult> {
	const result = await run(ExportMain, options);
	await ExpectValidResponse(result, ExportMain);
	return result;
}

/** The layout without the values - what every entry point must agree on */
function shape(result: HandlerResult) {
	return { title: embedOf(result).title, ids: customIDs(result), rows: screen(result).components!.length };
}

describe('export-main', () => {
	it('reports an expired session, clearing components and files', async () => {
		const result = await render();

		expect(screen(result)).toEqual({
			embeds: [ expect.objectContaining({ description: TIMEOUT_TEXT }) ],
			components: [],
			files: []
		});
	});

	it('shows a cached channel as a mention without touching the DB', async () => {
		seedSession(client);
		const result = await render({ channels: new Map([ [ CHANNEL_ID, { id: CHANNEL_ID } ] ]) });

		expect(embedOf(result).description).toContain(`Channel: <#${CHANNEL_ID}>`);
		expect(query).not.toHaveBeenCalled();
	});

	it('falls back to the stored #name for an uncached channel', async () => {
		seedSession(client);
		query.mockResolvedValue([{ name: '#general' }]);
		const result = await render();

		expect(embedOf(result).description).toContain('Channel: #general');
		expect(query).toHaveBeenCalledWith(expect.stringContaining('FROM Channels'), [ BigInt(CHANNEL_ID) ]);
	});

	it('falls back to Unknown Channel when the channel was never saved', async () => {
		seedSession(client);
		query.mockResolvedValue([]);
		const result = await render();

		expect(embedOf(result).description).toContain('Channel: Unknown Channel');
	});

	it('shows the current format and message count', async () => {
		seedSession(client, { format: FORMAT.JSON, messageCount: 1234 });
		query.mockResolvedValue([]);
		const description = embedOf(await render()).description!;

		expect(description).toContain(`Format: ${FORMAT_EMOJIS[FORMAT.JSON]} ${FORMAT_NAMES[FORMAT.JSON]}`);
		expect(description).toContain('Messages: 1234');
	});

	it.each([ [ 0, true ], [ 1, false ], [ 100, false ] ])('with %i messages the Export button disabled is %s', async (messageCount, disabled) => {
		seedSession(client, { messageCount });
		query.mockResolvedValue([]);
		const exportButton = buttonsOf(await render()).find(button => 'custom_id' in button && button.custom_id === 'export-finish')!;

		expect(!!exportButton.disabled).toBe(disabled);
	});

	it('offers channel, format, messages, export and cancel', async () => {
		seedSession(client);
		query.mockResolvedValue([]);

		expect(customIDs(await render())).toEqual([ 'export-channel', 'export-format', 'export-messages', 'export-finish', 'export-cancel' ]);
	});
});

describe('every way back to export-main lands on the same screen', () => {
	let expected: ReturnType<typeof shape>;

	beforeEach(async () => {
		seedSession(client);
		query.mockResolvedValue([]);
		expected = shape(await render());
	});

	it.each([
		[ 'the format picker', ExportFormat ],
		[ 'the cancel prompt', ExportCancel ]
	])('%s has a button back to export-main', async (_, handler) => {
		const ids = customIDs(await run(handler));
		expect(ids).toContain('export-main');
	});

	it('/export', async () => {
		client.exportCache.cache.clear();
		query.mockImplementation(async (sql: string) => sql.includes('COUNT(*)') ? [{ count: 250n }] : []);
		const command = interaction({ customId: 'export' }) as unknown as Parameters<CommandHandler['execute']>[0];
		// A getter on the discord.js prototype, so it has to be shadowed rather than assigned
		Object.defineProperty(command, 'channel', { value: { id: CHANNEL_ID } });

		const result = await ExportCommand.execute(command, client);

		await ExpectValidResponse(result, ExportCommand);
		expect(shape(result)).toEqual(expected);
	});

	it('the channel modal', async () => {
		query.mockImplementation(async (sql: string) => sql.includes('COUNT(*)') ? [{ count: 250n }] : []);
		const target = { id: OTHER_CHANNEL_ID, type: ChannelType.GuildText, permissionsFor: () => ({ has: () => true }) };
		const modal = interaction({ kind: 'modal', selectedChannels: { data: target } });

		const result = await ExportChannelModal.execute(modal as unknown as Parameters<ModalHandler['execute']>[0], client, []);

		await ExpectValidResponse(result, ExportChannelModal);
		expect(shape(result)).toEqual(expected);
	});

	it('the messages modal', async () => {
		query.mockImplementation(async (sql: string) => sql.includes('COUNT(*)') ? [{ count: 250n }] : []);
		const modal = interaction({ kind: 'modal', fields: { data: '50' } });

		const result = await ExportMessagesModal.execute(modal as unknown as Parameters<ModalHandler['execute']>[0], client, []);

		await ExpectValidResponse(result, ExportMessagesModal);
		expect(shape(result)).toEqual(expected);
	});
});
