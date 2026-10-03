import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ButtonHandler } from '../../Typings/HandlerTypes.js';
import { DiscordPermissions } from '../../Utils/DiscordConstants.js';
import { COLOR } from '../../Utils/Constants.js';
import { makeHandler, makeInteraction } from '../Components/Helpers.js';

/**
 * The select menu dispatcher. It shares `Respond.ts` with buttons, so this covers the menu-specific
 * routing plus one case per outcome to prove the wiring - the outcome matrix lives in Buttons.test.ts.
 */

const { GetUser, GetGuild, Log, menus } = vi.hoisted(() => ({
	GetUser: vi.fn(),
	GetGuild: vi.fn(),
	Log: vi.fn(),
	menus: new Map<string, unknown>()
}));
vi.mock('../../CRUD/Users.js', () => ({ GetUser }));
vi.mock('../../CRUD/Guilds.js', () => ({ GetGuild }));
vi.mock('../../Utils/Log.js', () => ({ Log }));
vi.mock('../../Database.js', () => ({ Database: { query: vi.fn(() => { throw new Error('unexpected query'); }) } }));
vi.mock('../../Client.js', () => ({ client: { menus } }));

const MenusHandler = (await import('../../Events/Handlers/SelectMenus.js')).default;

const MODAL = { title: 'Modal', custom_id: 'set-timezone', components: [] };
const SCREEN = { embeds: [{ description: 'screen' }], components: [] };

function register(handler: ButtonHandler): ButtonHandler {
	menus.set(handler.customID, handler);
	return handler;
}

function pick(customId: string, values: string[] = [ 'a' ], options: Parameters<typeof makeInteraction>[0] = {}) {
	const interaction = makeInteraction({ kind: 'menu', customId, values, memberPerms: [], ...options });
	return { interaction, done: MenusHandler.execute(interaction) };
}

beforeEach(() => {
	vi.clearAllMocks();
	menus.clear();
	GetUser.mockResolvedValue({ terms_version_accepted: 0 });
	GetGuild.mockResolvedValue({ features: 0 });
});

describe('SelectMenus dispatcher', () => {
	it('replies "Dropdown not found" for an unknown prefix without deferring', async () => {
		const { interaction, done } = pick('nope_1');
		await done;

		expect(interaction.reply).toHaveBeenCalledWith({ embeds: [ expect.objectContaining({ description: 'Dropdown not found :(' }) ] });
		expect(interaction.deferUpdate).not.toHaveBeenCalled();
	});

	it('passes args and values through untouched', async () => {
		const handler = register(makeHandler('test', {}, SCREEN));
		const values = [ '123', 'a_b', '' ];
		const { interaction, done } = pick('test_x_', values);
		await done;

		expect(handler.execute).toHaveBeenCalledWith(interaction, expect.anything(), [ 'x', '' ]);
		expect(interaction.values).toEqual([ '123', 'a_b', '' ]);
	});

	it('editReplies an update-type response after deferUpdate', async () => {
		register(makeHandler('test', { response_type: 'update' }, SCREEN));
		const { interaction, done } = pick('test');
		await done;

		expect(interaction.deferUpdate).toHaveBeenCalledOnce();
		expect(interaction.editReply).toHaveBeenCalledExactlyOnceWith(SCREEN);
	});

	it('editReplies a reply-type response after deferReply', async () => {
		register(makeHandler('test', { response_type: 'reply' }, SCREEN));
		const { interaction, done } = pick('test');
		await done;

		expect(interaction.deferReply).toHaveBeenCalledOnce();
		expect(interaction.editReply).toHaveBeenCalledExactlyOnceWith(SCREEN);
	});

	it('shows a modal-type response without deferring', async () => {
		register(makeHandler('test', { response_type: 'modal' }, MODAL));
		const { interaction, done } = pick('test');
		await done;

		expect(interaction.showModal).toHaveBeenCalledExactlyOnceWith(MODAL);
		expect(interaction.deferUpdate).not.toHaveBeenCalled();
		expect(interaction.deferReply).not.toHaveBeenCalled();
	});

	it('replies a denial when nothing acknowledged the interaction', async () => {
		register(makeHandler('test', { response_type: 'modal', permissions: [ DiscordPermissions.ManageGuild ] }, MODAL));
		const { interaction, done } = pick('test');
		await done;

		expect(interaction.reply).toHaveBeenCalledOnce();
		expect(interaction.editReply).not.toHaveBeenCalled();
	});

	it('editReplies a denial once deferred', async () => {
		register(makeHandler('test', { response_type: 'update', permissions: [ DiscordPermissions.ManageGuild ] }, SCREEN));
		const { interaction, done } = pick('test');
		await done;

		expect(interaction.editReply).toHaveBeenCalledOnce();
		expect(interaction.editReply.mock.calls[0][0]).toMatchObject({ components: [] });
		expect(interaction.reply).not.toHaveBeenCalled();
	});

	it('edits an error embed in when the handler throws', async () => {
		register(makeHandler('test', { execute: vi.fn(async () => { throw new Error('boom'); }) }));
		const { interaction, done } = pick('test');
		await done;

		expect(Log).toHaveBeenCalledWith('ERROR', expect.any(Error));
		expect(interaction.editReply.mock.calls[0][0]).toMatchObject({ embeds: [{ color: COLOR.ERROR }], components: [] });
	});
});
