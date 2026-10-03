import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ButtonHandler } from '../../Typings/HandlerTypes.js';
import { DiscordPermissions } from '../../Utils/DiscordConstants.js';
import { COLOR } from '../../Utils/Constants.js';
import { makeHandler, makeInteraction } from '../Components/Helpers.js';

/**
 * The button dispatcher (`Events/Handlers/Buttons.ts` -> `Respond.ts`): what actually gets sent for
 * each outcome. `CheckHandlerAccess` is kept real, with only the user/guild lookups stubbed, so the
 * deferral it performs is part of what is observed.
 */

const { GetUser, GetGuild, Log, buttons } = vi.hoisted(() => ({
	GetUser: vi.fn(),
	GetGuild: vi.fn(),
	Log: vi.fn(),
	buttons: new Map<string, unknown>()
}));
vi.mock('../../CRUD/Users.js', () => ({ GetUser }));
vi.mock('../../CRUD/Guilds.js', () => ({ GetGuild }));
vi.mock('../../Utils/Log.js', () => ({ Log }));
vi.mock('../../Database.js', () => ({ Database: { query: vi.fn(() => { throw new Error('unexpected query'); }) } }));
vi.mock('../../Client.js', () => ({ client: { buttons } }));

const ButtonsHandler = (await import('../../Events/Handlers/Buttons.js')).default;
const Close = (await import('../../Buttons/Close.js')).default;

const MODAL = { title: 'Modal', custom_id: 'set-timezone', components: [] };
const SCREEN = { embeds: [{ description: 'screen' }], components: [] };

function register(handler: ButtonHandler): ButtonHandler {
	buttons.set(handler.customID, handler);
	return handler;
}

/** Fails the permission gate - members are built with no permissions */
const GATED = { permissions: [ DiscordPermissions.ManageGuild ] };

function press(customId: string, options: Parameters<typeof makeInteraction>[0] = {}) {
	const interaction = makeInteraction({ kind: 'button', customId, memberPerms: [], ...options });
	return { interaction, done: ButtonsHandler.execute(interaction) };
}

function isErrorEmbed(payload: unknown): boolean {
	const response = payload as { embeds?: { color?: number }[], components?: unknown[] };
	return response.embeds?.[0]?.color === COLOR.ERROR && Array.isArray(response.components) && response.components.length === 0;
}

beforeEach(() => {
	vi.clearAllMocks();
	buttons.clear();
	GetUser.mockResolvedValue({ terms_version_accepted: 0 });
	GetGuild.mockResolvedValue({ features: 0 });
});

describe('Buttons dispatcher - routing', () => {
	it('replies "Button not found" for an unknown prefix without deferring', async () => {
		const { interaction, done } = press('nope_1');
		await done;

		expect(interaction.reply).toHaveBeenCalledWith({ embeds: [ expect.objectContaining({ description: 'Button not found :(' }) ] });
		expect(interaction.deferUpdate).not.toHaveBeenCalled();
		expect(interaction.deferReply).not.toHaveBeenCalled();
	});

	it('splits args on _ and keeps empty trailing segments', async () => {
		const handler = register(makeHandler('test', {}, SCREEN));
		const { interaction, done } = press('test_a__b_');
		await done;

		expect(handler.execute).toHaveBeenCalledWith(interaction, expect.anything(), [ 'a', '', 'b', '' ]);
	});
});

describe('Buttons dispatcher - responses', () => {
	it('defers an update-type handler with deferUpdate, then editReplies its response', async () => {
		register(makeHandler('test', { response_type: 'update' }, SCREEN));
		const { interaction, done } = press('test');
		await done;

		expect(interaction.deferUpdate).toHaveBeenCalledOnce();
		expect(interaction.editReply).toHaveBeenCalledExactlyOnceWith(SCREEN);
	});

	it('defers a reply-type handler with deferReply honouring hidden, then editReplies its response', async () => {
		register(makeHandler('test', { response_type: 'reply', hidden: true }, SCREEN));
		const { interaction, done } = press('test');
		await done;

		expect(interaction.deferReply).toHaveBeenCalledWith({ flags: 64 });
		expect(interaction.editReply).toHaveBeenCalledExactlyOnceWith(SCREEN);
	});

	it('calls showModal for a modal-type handler and never defers it', async () => {
		register(makeHandler('test', { response_type: 'modal' }, MODAL));
		const { interaction, done } = press('test');
		await done;

		expect(interaction.showModal).toHaveBeenCalledExactlyOnceWith(MODAL);
		expect(interaction.deferUpdate).not.toHaveBeenCalled();
		expect(interaction.deferReply).not.toHaveBeenCalled();
		expect(interaction.editReply).not.toHaveBeenCalled();
	});

	it('logs and replies an error when a modal-type handler returns something that is not a modal', async () => {
		register(makeHandler('test', { response_type: 'modal' }, SCREEN));
		const { interaction, done } = press('test');
		await done;

		expect(interaction.showModal).not.toHaveBeenCalled();
		expect(Log).toHaveBeenCalledWith('ERROR', expect.any(Error));
		expect(interaction.reply).toHaveBeenCalledOnce();
		expect(isErrorEmbed(interaction.reply.mock.calls[0][0])).toBe(true);
		expect(interaction.reply.mock.calls[0][0]).toMatchObject({ flags: 64 });
	});

	it('logs and edits in an error when a deferred handler returns a modal it can no longer show', async () => {
		register(makeHandler('test', { response_type: 'update' }, MODAL));
		const { interaction, done } = press('test');
		await done;

		expect(interaction.showModal).not.toHaveBeenCalled();
		expect(isErrorEmbed(interaction.editReply.mock.calls[0][0])).toBe(true);
	});
});

describe('Buttons dispatcher - deleting the message', () => {
	// Bug: Close called deleteReply itself and returned {}, and the dispatcher then editReplied the
	// message it had just deleted
	it('deletes the reply for close and never edits it afterwards', async () => {
		register(Close);
		const { interaction, done } = press('close');
		await done;

		expect(interaction.deferUpdate).toHaveBeenCalledOnce();
		expect(interaction.deleteReply).toHaveBeenCalledOnce();
		expect(interaction.editReply).not.toHaveBeenCalled();
	});

	it('deletes the reply for any handler returning the delete marker', async () => {
		register(makeHandler('test', {}, { delete: true }));
		const { interaction, done } = press('test');
		await done;

		expect(interaction.deleteReply).toHaveBeenCalledOnce();
		expect(interaction.editReply).not.toHaveBeenCalled();
	});

	it('close no longer touches the interaction itself', async () => {
		const interaction = makeInteraction();
		expect(await Close.execute(interaction, {} as never, [])).toEqual({ delete: true });
		expect(interaction.deleteReply).not.toHaveBeenCalled();
	});
});

describe('Buttons dispatcher - follow-ups', () => {
	it('sends a follow-up as an ephemeral message and leaves the deferred message alone', async () => {
		const followUp = { embeds: [{ description: 'refused' }] };
		register(makeHandler('test', {}, { followUp }));
		const { interaction, done } = press('test');
		await done;

		expect(interaction.followUp).toHaveBeenCalledExactlyOnceWith({ ...followUp, flags: 64 });
		expect(interaction.editReply).not.toHaveBeenCalled();
		expect(interaction.deleteReply).not.toHaveBeenCalled();
	});
});

describe('Buttons dispatcher - failures', () => {
	it('edits an error embed over a deferred update when the handler throws, clearing components', async () => {
		register(makeHandler('test', { execute: vi.fn(async () => { throw new Error('boom'); }) }));
		const { interaction, done } = press('test');
		await done;

		expect(Log).toHaveBeenCalledWith('ERROR', expect.objectContaining({ message: 'boom' }));
		expect(interaction.editReply).toHaveBeenCalledOnce();
		expect(isErrorEmbed(interaction.editReply.mock.calls[0][0])).toBe(true);
	});

	it('replies an ephemeral error when a modal-type handler throws before acknowledging', async () => {
		register(makeHandler('test', { response_type: 'modal', execute: vi.fn(async () => { throw new Error('boom'); }) }));
		const { interaction, done } = press('test');
		await done;

		expect(interaction.reply).toHaveBeenCalledOnce();
		expect(interaction.reply.mock.calls[0][0]).toMatchObject({ flags: 64 });
		expect(isErrorEmbed(interaction.reply.mock.calls[0][0])).toBe(true);
	});

	it('treats an empty response as an error', async () => {
		register(makeHandler('test', {}, null));
		const { interaction, done } = press('test');
		await done;

		expect(Log).toHaveBeenCalledWith('ERROR', expect.any(Error));
		expect(isErrorEmbed(interaction.editReply.mock.calls[0][0])).toBe(true);
	});

	it('answers with an error when the access check itself fails', async () => {
		GetUser.mockRejectedValue(new Error('db down'));
		register(makeHandler('test', {}, SCREEN));
		const { interaction, done } = press('test');
		await done;

		expect(isErrorEmbed(interaction.editReply.mock.calls[0][0])).toBe(true);
	});

	it('does not throw when the final edit fails (expired interaction)', async () => {
		register(makeHandler('test', {}, SCREEN));
		const { interaction, done } = press('test');
		interaction.editReply.mockRejectedValue(new Error('Unknown interaction'));

		await expect(done).resolves.toBeUndefined();
		expect(Log).toHaveBeenCalledWith('ERROR', expect.any(Error));
	});
});

describe('Buttons dispatcher - denials', () => {
	it('uses reply() when a modal-type handler is denied before being acknowledged', async () => {
		const handler = register(makeHandler('test', { response_type: 'modal', ...GATED }, MODAL));
		const { interaction, done } = press('test');
		await done;

		expect(interaction.reply).toHaveBeenCalledOnce();
		expect(interaction.editReply).not.toHaveBeenCalled();
		expect(handler.execute).not.toHaveBeenCalled();
	});

	it('uses editReply() when the interaction was deferred', async () => {
		const handler = register(makeHandler('test', { response_type: 'update', ...GATED }, SCREEN));
		const { interaction, done } = press('test');
		await done;

		expect(interaction.editReply).toHaveBeenCalledOnce();
		expect(interaction.reply).not.toHaveBeenCalled();
		expect(handler.execute).not.toHaveBeenCalled();
	});

	// Otherwise the user keeps clicking the old screen's buttons and is denied again each time
	it('clears the old screen\'s components when denying a deferred update', async () => {
		register(makeHandler('test', { response_type: 'update', ...GATED }, SCREEN));
		const { interaction, done } = press('test');
		await done;

		expect(interaction.editReply.mock.calls[0][0]).toMatchObject({ components: [] });
	});

	it('clears components on a guild feature denial too', async () => {
		register(makeHandler('test', { guild_features: [ 8 as never ] }, SCREEN));
		const { interaction, done } = press('test');
		await done;

		expect(interaction.editReply.mock.calls[0][0]).toMatchObject({ embeds: [ expect.objectContaining({ title: 'Feature Disabled' }) ], components: [] });
	});
});
