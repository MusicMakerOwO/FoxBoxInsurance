import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ButtonHandler } from '../../Typings/HandlerTypes.js';
import { DiscordPermissions } from '../../Utils/DiscordConstants.js';
import { COLOR } from '../../Utils/Constants.js';
import { makeHandler, makeInteraction } from '../Components/Helpers.js';

/**
 * The modal submit dispatcher. Modal handlers are only ever `reply` or `update`, so every path is
 * deferred before the handler runs and every answer is an editReply.
 */

const { GetUser, GetGuild, Log, modals } = vi.hoisted(() => ({
	GetUser: vi.fn(),
	GetGuild: vi.fn(),
	Log: vi.fn(),
	modals: new Map<string, unknown>()
}));
vi.mock('../../CRUD/Users.js', () => ({ GetUser }));
vi.mock('../../CRUD/Guilds.js', () => ({ GetGuild }));
vi.mock('../../Utils/Log.js', () => ({ Log }));
vi.mock('../../Database.js', () => ({ Database: { query: vi.fn(() => { throw new Error('unexpected query'); }) } }));
vi.mock('../../Client.js', () => ({ client: { modals } }));

const ModalsHandler = (await import('../../Events/Handlers/Modals.js')).default;

const SCREEN = { embeds: [{ description: 'screen' }], components: [] };

function register(handler: ButtonHandler): ButtonHandler {
	modals.set(handler.customID, handler);
	return handler;
}

function submit(customId: string, options: Parameters<typeof makeInteraction>[0] = {}) {
	const interaction = makeInteraction({ kind: 'modal', customId, memberPerms: [], fields: { data: 'value' }, ...options });
	return { interaction, done: ModalsHandler.execute(interaction) };
}

beforeEach(() => {
	vi.clearAllMocks();
	modals.clear();
	GetUser.mockResolvedValue({ terms_version_accepted: 0 });
	GetGuild.mockResolvedValue({ features: 0 });
});

describe('Modals dispatcher', () => {
	it('replies "Modal not found" for an unknown prefix without deferring', async () => {
		const { interaction, done } = submit('nope_1');
		await done;

		expect(interaction.reply).toHaveBeenCalledWith({ embeds: [ expect.objectContaining({ description: 'Modal not found :(' }) ] });
		expect(interaction.deferUpdate).not.toHaveBeenCalled();
		expect(interaction.deferReply).not.toHaveBeenCalled();
	});

	it('splits args on _', async () => {
		const handler = register(makeHandler('test', {}, SCREEN));
		const { interaction, done } = submit('test_week_');
		await done;

		expect(handler.execute).toHaveBeenCalledWith(interaction, expect.anything(), [ 'week', '' ]);
	});

	it('defers an update-type modal with deferUpdate, then editReplies', async () => {
		register(makeHandler('test', { response_type: 'update' }, SCREEN));
		const { interaction, done } = submit('test');
		await done;

		expect(interaction.deferUpdate).toHaveBeenCalledOnce();
		expect(interaction.deferReply).not.toHaveBeenCalled();
		expect(interaction.editReply).toHaveBeenCalledExactlyOnceWith(SCREEN);
	});

	it('defers a reply-type modal with deferReply honouring hidden, then editReplies', async () => {
		register(makeHandler('test', { response_type: 'reply', hidden: true }, SCREEN));
		const { interaction, done } = submit('test');
		await done;

		expect(interaction.deferReply).toHaveBeenCalledWith({ flags: 64 });
		expect(interaction.editReply).toHaveBeenCalledExactlyOnceWith(SCREEN);
	});

	it('editReplies the refusal on a denial, without running the handler', async () => {
		const handler = register(makeHandler('test', { permissions: [ DiscordPermissions.ManageGuild ] }, SCREEN));
		const { interaction, done } = submit('test');
		await done;

		expect(handler.execute).not.toHaveBeenCalled();
		expect(interaction.reply).not.toHaveBeenCalled();
		expect(interaction.editReply).toHaveBeenCalledOnce();
		expect(interaction.editReply.mock.calls[0][0]).toMatchObject({ components: [] });
	});

	it('edits an error embed in when the handler throws', async () => {
		register(makeHandler('test', { execute: vi.fn(async () => { throw new Error('boom'); }) }));
		const { interaction, done } = submit('test');
		await done;

		expect(Log).toHaveBeenCalledWith('ERROR', expect.any(Error));
		expect(interaction.editReply.mock.calls[0][0]).toMatchObject({ embeds: [{ color: COLOR.ERROR }], components: [] });
	});

	it('sends a follow-up as an ephemeral message and leaves the deferred message alone', async () => {
		const followUp = { embeds: [{ description: 'refused' }] };
		register(makeHandler('test', {}, { followUp }));
		const { interaction, done } = submit('test');
		await done;

		expect(interaction.followUp).toHaveBeenCalledExactlyOnceWith({ ...followUp, flags: 64 });
		expect(interaction.editReply).not.toHaveBeenCalled();
	});

	it('deletes the reply on the delete marker', async () => {
		register(makeHandler('test', {}, { delete: true }));
		const { interaction, done } = submit('test');
		await done;

		expect(interaction.deleteReply).toHaveBeenCalledOnce();
		expect(interaction.editReply).not.toHaveBeenCalled();
	});
});
