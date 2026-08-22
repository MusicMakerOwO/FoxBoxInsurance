import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ChatInputCommandInteraction } from 'discord.js';
import { TOS_FEATURES } from '../TOSConstants.js';
import { CommandHandler } from '../Typings/HandlerTypes.js';

const { GetUser } = vi.hoisted(() => ({ GetUser: vi.fn() }));
vi.mock('../CRUD/Users.js', () => ({ GetUser }));

import { CheckHandlerAccess } from '../Utils/CheckHandlerAccess.js';

function makeInteraction(): ChatInputCommandInteraction {
	return {
		user       : { id: '900000000000000005' },
		deferUpdate: vi.fn(),
		deferReply : vi.fn()
	} as unknown as ChatInputCommandInteraction;
}

function makeHandler(overrides: Partial<CommandHandler> = {}): CommandHandler {
	return {
		tos_features  : [TOS_FEATURES.DATA_COLLECTION_OPT_OUT],
		guild_features: [],
		permissions   : [],
		response_type : 'reply',
		hidden        : true,
		...overrides
	} as CommandHandler;
}

beforeEach(() => {
	GetUser.mockReset();
});

describe('CheckHandlerAccess', () => {
	it('encodes the actual target TOS version in the first-time accept button, not a bare tos-accept id', async () => {
		GetUser.mockResolvedValue({ terms_version_accepted: 0 });

		const result = await CheckHandlerAccess(makeInteraction(), makeHandler());

		// DATA_COLLECTION_OPT_OUT is only introduced in TOS version 4 - a first-time user
		// should be routed through the versioned changelog prompt, not straight to MAX_TOS_VERSION.
		const acceptButton = result!.components![0].components[1] as { custom_id: string };
		expect(acceptButton.custom_id).toBe('tos-accept_4');
	});
});
