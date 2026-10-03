import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ChannelType, PermissionsBitField } from 'discord.js';
import { IClient } from '../../../Client.js';
import { ModalHandler } from '../../../Typings/HandlerTypes.js';
import { ExpectValidModal, ExpectValidResponse, HandlerResult, embedOf, makeClient, screen } from '../Helpers.js';
import { CHANNEL_ID, OPEN_GATES, OTHER_CHANNEL_ID, SESSION_KEY, TIMEOUT_TEXT, dispatch, interaction, seedSession } from './Fixtures.js';

/**
 * The two modal-type buttons on the export menu (`export-channel`, `export-messages`) and the modal
 * submits they open. A modal has to be shown within Discord's 3 second window and can't be shown
 * from a deferred interaction, so the buttons never look at the session - the submit does.
 */

const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('../../../Database.js', () => ({ Database: { query } }));

const { clientRef, GetUser, GetGuild, CanMemberExportChannel } = vi.hoisted(() => ({
	clientRef: {} as Record<string, unknown>,
	GetUser: vi.fn(),
	GetGuild: vi.fn(),
	CanMemberExportChannel: vi.fn()
}));
vi.mock('../../../Client.js', () => ({ client: clientRef }));
vi.mock('../../../CRUD/Users.js', () => ({ GetUser }));
vi.mock('../../../CRUD/Guilds.js', () => ({ GetGuild }));
vi.mock('../../../Services/ExportAccess.js', async (importOriginal) => ({ ...await importOriginal<object>(), CanMemberExportChannel }));

const ChannelButton = (await import('../../../Buttons/Exports/ExportChannel.js')).default;
const MessagesButton = (await import('../../../Buttons/Exports/ExportMessages.js')).default;
const ChannelModal = (await import('../../../Modals/ExportChannel.js')).default;
const MessagesModal = (await import('../../../Modals/ExportMessages.js')).default;

let client: IClient;

/** Answers the channel message COUNT(*) with `total`, and the export-main name lookup with nothing */
function channelTotal(total: bigint) {
	query.mockImplementation(async (sql: string) => sql.includes('COUNT(*)') ? [{ count: total }] : []);
}

beforeEach(async () => {
	vi.clearAllMocks();
	query.mockImplementation(async () => { throw new Error('unexpected query'); });
	GetUser.mockResolvedValue(OPEN_GATES.user);
	GetGuild.mockResolvedValue(OPEN_GATES.guild);
	CanMemberExportChannel.mockResolvedValue(true);
	client = Object.assign(clientRef, await makeClient()) as unknown as IClient;
	client.exportCache.cache.clear();
});

async function submit(handler: ModalHandler, options: Parameters<typeof interaction>[0]): Promise<HandlerResult> {
	const sent = interaction({ kind: 'modal', ...options });
	const result = await handler.execute(sent as unknown as Parameters<ModalHandler['execute']>[0], client, []);
	await ExpectValidResponse(result, handler);
	return result;
}

/** The refusal text of a follow-up-only response, failing if the screen would have been touched */
function refusal(result: HandlerResult): string {
	const response = screen(result);
	expect(Object.keys(response)).toEqual([ 'followUp' ]);
	return response.followUp!.embeds![0].description!;
}

//////////////////
// The buttons
//////////////////

describe('export-channel / export-messages buttons', () => {
	// Bug: both looked the session up first, and on a miss called editReply on an interaction that
	// was never deferred, then returned {} from a modal-type handler
	it.each([
		[ 'export-channel', ChannelButton ],
		[ 'export-messages', MessagesButton ]
	])('%s returns its modal even when the session has expired', async (_, button) => {
		const sent = interaction();
		const result = await button.execute(sent, client, []);

		await ExpectValidModal(result);
		expect(sent.editReply).not.toHaveBeenCalled();
	});

	it.each([ [ 'export-channel' ], [ 'export-messages' ] ])('[dispatcher] %s shows the modal and never edits or replies', async (customId) => {
		const sent = await dispatch('button', customId);

		expect(sent.showModal).toHaveBeenCalledOnce();
		expect(sent.editReply).not.toHaveBeenCalled();
		expect(sent.reply).not.toHaveBeenCalled();
		expect(sent.deferUpdate).not.toHaveBeenCalled();
	});

	it('the channel modal routes to the export-channel modal with a required channel select', async () => {
		const result = await ChannelButton.execute(interaction(), client, []) as { custom_id: string, components: { component: { type: number, required: boolean } }[] };

		expect(result.custom_id).toBe('export-channel');
		expect(result.components[0].component).toMatchObject({ type: 8, required: true });
	});

	it('the messages modal routes to the export-messages modal with a 1-6 char input', async () => {
		const result = await MessagesButton.execute(interaction(), client, []) as { custom_id: string, components: { components: unknown[] }[] };

		expect(result.custom_id).toBe('export-messages');
		expect(result.components[0].components[0]).toMatchObject({ type: 4, custom_id: 'data', min_length: 1, max_length: 6, required: true });
	});
});

//////////////////
// Channel modal
//////////////////

function channel(type: ChannelType = ChannelType.GuildText, canView = true) {
	return {
		id: OTHER_CHANNEL_ID,
		type,
		permissionsFor: vi.fn(() => ({ has: (permission: string) => permission === 'ViewChannel' && canView }))
	};
}

function pickChannel(target: ReturnType<typeof channel>, memberPerms: bigint[] = []) {
	return submit(ChannelModal, { memberPerms, selectedChannels: { data: target } });
}

describe('export-channel modal', () => {
	it('reports an expired session', async () => {
		const result = await pickChannel(channel());
		expect(screen(result)).toMatchObject({ embeds: [{ description: TIMEOUT_TEXT }], components: [], files: [] });
	});

	it('tells a non-admin who cannot view the channel that it is unknown', async () => {
		const session = seedSession(client);
		const result = await pickChannel(channel(ChannelType.GuildText, false));

		expect(refusal(result)).toMatch(/Unknown channel/);
		expect(session.channelID).toBe(BigInt(CHANNEL_ID));
	});

	it('lets an admin skip the ViewChannel check', async () => {
		seedSession(client);
		channelTotal(50n);
		const target = channel(ChannelType.GuildText, false);
		const result = await pickChannel(target, [ PermissionsBitField.Flags.Administrator ]);

		expect(target.permissionsFor).not.toHaveBeenCalled();
		expect(embedOf(result).title).toBe('Export Options');
	});

	it.each([
		[ 'a category', ChannelType.GuildCategory ],
		[ 'a forum', ChannelType.GuildForum ],
		[ 'a private thread', ChannelType.PrivateThread ]
	])('refuses %s as incompatible', async (_, type) => {
		const session = seedSession(client);
		const result = await pickChannel(channel(type));

		expect(refusal(result)).toMatch(/Cannot export this channel/);
		expect(session.channelID).toBe(BigInt(CHANNEL_ID));
	});

	it('refuses a channel the member may not export', async () => {
		const session = seedSession(client);
		CanMemberExportChannel.mockResolvedValue(false);
		const result = await pickChannel(channel());

		expect(refusal(result)).toMatch(/cannot be exported/);
		expect(session.channelID).toBe(BigInt(CHANNEL_ID));
	});

	it('switches the session to the picked channel and renders export-main', async () => {
		seedSession(client);
		channelTotal(500n);
		const result = await pickChannel(channel());

		expect(client.exportCache.get(SESSION_KEY)!.channelID).toBe(BigInt(OTHER_CHANNEL_ID));
		expect(embedOf(result).title).toBe('Export Options');
		expect(embedOf(result).description).toContain('Messages: 100');
	});

	it.each([
		[ 'keeps the chosen count when the new channel has more', 5000, 8000n, 5000 ],
		[ 'clamps the chosen count to the new channel\'s total', 5000, 300n, 300 ],
		[ 'keeps a small chosen count', 40, 300n, 40 ]
	])('%s', async (_, chosen, total, expected) => {
		seedSession(client, { messageCount: chosen });
		channelTotal(total);
		await pickChannel(channel());

		expect(client.exportCache.get(SESSION_KEY)!.messageCount).toBe(expected);
	});
});

//////////////////
// Messages modal
//////////////////

function enterCount(data: string) {
	return submit(MessagesModal, { fields: { data } });
}

describe('export-messages modal', () => {
	it.each([
		// Bug: '0' was turned into 100 by `|| 100`
		[ '0', /less than 20/ ],
		[ '19', /less than 20/ ],
		[ '10001', /more than 10,000/ ],
		[ 'abc', /enter a number/i ]
	])('refuses %s before touching the session or the DB', async (data, message) => {
		const session = seedSession(client, { messageCount: 100 });
		const get = vi.spyOn(client.exportCache, 'get');
		const result = await enterCount(data);

		expect(refusal(result)).toMatch(message);
		expect(query).not.toHaveBeenCalled();
		expect(get).not.toHaveBeenCalled();
		expect(session.messageCount).toBe(100);
	});

	it.each([
		[ '20', 20 ],
		[ '10000', 10_000 ],
		[ '10,000', 10_000 ],
		[ '10 000', 10_000 ]
	])('accepts %s', async (data, expected) => {
		seedSession(client);
		channelTotal(20_000n);
		const result = await enterCount(data);

		expect(client.exportCache.get(SESSION_KEY)!.messageCount).toBe(expected);
		expect(embedOf(result).description).toContain(`Messages: ${expected}`);
	});

	it('clamps the count to the channel\'s saved message total', async () => {
		seedSession(client);
		channelTotal(300n);
		await enterCount('5000');

		expect(client.exportCache.get(SESSION_KEY)!.messageCount).toBe(300);
	});

	it('reports an expired session after a valid count', async () => {
		const result = await enterCount('500');
		expect(screen(result)).toMatchObject({ embeds: [{ description: TIMEOUT_TEXT }], components: [], files: [] });
	});

	it('[dispatcher] a refused count sends one ephemeral follow-up and leaves the export menu as it was', async () => {
		seedSession(client);
		const sent = await dispatch('modal', 'export-messages', { fields: { data: '5' } });

		expect(sent.deferUpdate).toHaveBeenCalledOnce();
		expect(sent.followUp).toHaveBeenCalledOnce();
		expect(sent.followUp.mock.calls[0][0]).toMatchObject({ flags: 64 });
		expect(sent.editReply).not.toHaveBeenCalled();
	});
});
