import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AutocompleteInteraction } from 'discord.js';
import { CommandHandler } from '../../Typings/HandlerTypes.js';
import { DiscordPermissions } from '../../Utils/DiscordConstants.js';
import { COLOR } from '../../Utils/Constants.js';
import { makeInteraction } from '../Components/Helpers.js';

/**
 * The slash command dispatcher. Commands go through the same `Respond.ts` path as components, so a
 * command is always deferred with deferReply and every answer is an editReply - including the error
 * embed for a handler that throws, which used to leave "thinking..." up forever.
 */

const { GetUser, GetGuild, Log, commands } = vi.hoisted(() => ({
	GetUser: vi.fn(),
	GetGuild: vi.fn(),
	Log: vi.fn(),
	commands: new Map<string, unknown>()
}));
vi.mock('../../CRUD/Users.js', () => ({ GetUser }));
vi.mock('../../CRUD/Guilds.js', () => ({ GetGuild }));
vi.mock('../../Utils/Log.js', () => ({ Log }));
vi.mock('../../Database.js', () => ({ Database: { query: vi.fn(() => { throw new Error('unexpected query'); }) } }));
vi.mock('../../Client.js', () => ({ client: { commands } }));

const CommandsHandler = (await import('../../Events/Handlers/Commands.js')).default;

const SCREEN = { embeds: [{ description: 'screen' }], components: [] };

/** An ungated stand-in command; `execute` is a spy returning `response` */
function register(name: string, overrides: Partial<CommandHandler> = {}, response: unknown = SCREEN): CommandHandler {
	const handler = {
		data          : { name },
		tos_features  : [],
		guild_features: [],
		permissions   : [],
		response_type : 'reply',
		hidden        : false,
		execute       : vi.fn(async () => response),
		...overrides
	} as unknown as CommandHandler;
	commands.set(name, handler);
	return handler;
}

function run(commandName: string, options: Parameters<typeof makeInteraction>[0] = {}) {
	const interaction = makeInteraction({ kind: 'command', commandName, memberPerms: [], ...options });
	return { interaction, done: CommandsHandler.execute(interaction) };
}

function isErrorEmbed(payload: unknown): boolean {
	const response = payload as { embeds?: { color?: number }[], components?: unknown[] };
	return response.embeds?.[0]?.color === COLOR.ERROR && Array.isArray(response.components) && response.components.length === 0;
}

beforeEach(() => {
	vi.clearAllMocks();
	commands.clear();
	GetUser.mockResolvedValue({ terms_version_accepted: 0 });
	GetGuild.mockResolvedValue({ features: 0 });
});

describe('Commands dispatcher', () => {
	it('replies "Command not found" for an unknown command without deferring', async () => {
		const { interaction, done } = run('nope');
		await done;

		expect(interaction.reply).toHaveBeenCalledWith({ embeds: [ expect.objectContaining({ description: 'Command not found :(' }) ] });
		expect(interaction.deferReply).not.toHaveBeenCalled();
	});

	it('runs the handler with the interaction and the client', async () => {
		const handler = register('test');
		const { interaction, done } = run('test');
		await done;

		expect(handler.execute).toHaveBeenCalledOnce();
		expect(vi.mocked(handler.execute).mock.calls[0][0]).toBe(interaction);
	});

	it.each([ [ true, { flags: 64 } ], [ false, { flags: undefined } ] ])('defers the reply with hidden=%s, then editReplies the response', async (hidden, deferral) => {
		register('test', { hidden });
		const { interaction, done } = run('test');
		await done;

		expect(interaction.deferReply).toHaveBeenCalledExactlyOnceWith(deferral);
		expect(interaction.deferUpdate).not.toHaveBeenCalled();
		expect(interaction.editReply).toHaveBeenCalledExactlyOnceWith(SCREEN);
	});

	it('editReplies the refusal on a denial, without running the handler', async () => {
		const handler = register('test', { permissions: [ DiscordPermissions.ManageGuild ] });
		const { interaction, done } = run('test');
		await done;

		expect(handler.execute).not.toHaveBeenCalled();
		expect(interaction.editReply).toHaveBeenCalledOnce();
		expect(interaction.editReply.mock.calls[0][0].embeds[0].description).toMatch(/missing the following permissions/);
	});

	// Bug: nothing caught a throwing command - the user was left on "thinking..." and the rejection
	// was unhandled
	it('edits an error embed in when the handler throws', async () => {
		register('test', { execute: vi.fn(async () => { throw new Error('boom'); }) });
		const { interaction, done } = run('test');
		await expect(done).resolves.toBeUndefined();

		expect(Log).toHaveBeenCalledWith('ERROR', expect.objectContaining({ message: 'boom' }));
		expect(interaction.editReply).toHaveBeenCalledOnce();
		expect(isErrorEmbed(interaction.editReply.mock.calls[0][0])).toBe(true);
	});

	it('edits an error embed in when the handler returns nothing, naming the command in the log', async () => {
		register('test', {}, null);
		const { interaction, done } = run('test');
		await done;

		expect(Log).toHaveBeenCalledWith('ERROR', expect.objectContaining({ message: expect.stringContaining(`'/test'`) }));
		expect(isErrorEmbed(interaction.editReply.mock.calls[0][0])).toBe(true);
	});

	it('edits an error embed in when the access check throws', async () => {
		register('test');
		GetUser.mockRejectedValue(new Error('db down'));
		const { interaction, done } = run('test');
		await done;

		expect(isErrorEmbed(interaction.editReply.mock.calls[0][0])).toBe(true);
	});

	// A command is always deferred, so a modal can no longer be shown for it
	it('answers a command that returns a modal with the error embed instead of an uncaught throw', async () => {
		register('test', {}, { title: 'Modal', custom_id: 'set-timezone', components: [] });
		const { interaction, done } = run('test');
		await done;

		expect(interaction.showModal).not.toHaveBeenCalled();
		expect(isErrorEmbed(interaction.editReply.mock.calls[0][0])).toBe(true);
	});

	it('a failed editReply is logged, not thrown', async () => {
		register('test');
		const { interaction, done } = run('test');
		interaction.editReply.mockRejectedValue(new Error('Unknown interaction'));

		await expect(done).resolves.toBeUndefined();
		expect(Log).toHaveBeenCalledWith('ERROR', expect.objectContaining({ message: 'Unknown interaction' }));
	});

	it('sends a follow-up and the delete marker like the component dispatchers do', async () => {
		const followUp = { embeds: [{ description: 'refused' }] };
		register('follow', {}, { followUp });
		register('delete', {}, { delete: true });

		const follow = run('follow');
		await follow.done;
		expect(follow.interaction.followUp).toHaveBeenCalledExactlyOnceWith({ ...followUp, flags: 64 });
		expect(follow.interaction.editReply).not.toHaveBeenCalled();

		const deleted = run('delete');
		await deleted.done;
		expect(deleted.interaction.deleteReply).toHaveBeenCalledOnce();
		expect(deleted.interaction.editReply).not.toHaveBeenCalled();
	});
});

describe('Commands dispatcher - autocomplete', () => {
	function autocomplete(commandName: string) {
		const interaction = Object.setPrototypeOf({ commandName, respond: vi.fn(async () => undefined) }, AutocompleteInteraction.prototype);
		return { interaction, done: CommandsHandler.execute(interaction) };
	}

	it('responds with the handler\'s choices, without deferring or running the command', async () => {
		const choices = [{ name: '/help', value: 'help' }];
		const handler = register('test', { autocomplete: vi.fn(async () => choices) });
		const { interaction, done } = autocomplete('test');
		await done;

		expect(interaction.respond).toHaveBeenCalledExactlyOnceWith(choices);
		expect(handler.execute).not.toHaveBeenCalled();
	});

	it('logs a command with no autocomplete callback instead of responding', async () => {
		register('test');
		const { interaction, done } = autocomplete('test');
		await done;

		expect(interaction.respond).not.toHaveBeenCalled();
		expect(Log).toHaveBeenCalledWith('ERROR', expect.stringContaining('Autocomplete'));
	});
});
