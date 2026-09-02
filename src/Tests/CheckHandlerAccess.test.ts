import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ButtonInteraction, ChatInputCommandInteraction, GuildMember, PermissionsBitField } from 'discord.js';
import { TOS_FEATURES } from '../TOSConstants.js';
import { GUILD_FEATURES } from '../Typings/DatabaseTypes.js';
import { DiscordPermissions } from '../Utils/DiscordConstants.js';
import { CommandHandler } from '../Typings/HandlerTypes.js';

const { GetUser, GetGuild } = vi.hoisted(() => ({ GetUser: vi.fn(), GetGuild: vi.fn() }));
vi.mock('../CRUD/Users.js', () => ({ GetUser }));
vi.mock('../CRUD/Guilds.js', () => ({ GetGuild }));

import { CheckHandlerAccess } from '../Utils/CheckHandlerAccess.js';

function makeInteraction(options: { permissions?: bigint[], guildId?: string } = {}): ChatInputCommandInteraction {
	return {
		user       : { id: '900000000000000005' },
		guildId    : options.guildId ?? '900000000000000006',
		member     : options.permissions === undefined ? undefined : {
			permissions: new PermissionsBitField(options.permissions)
		} as GuildMember,
		deferUpdate: vi.fn(),
		deferReply : vi.fn()
	} as unknown as ChatInputCommandInteraction;
}

/**
 * The same stub, but a genuine `instanceof CommandInteraction`, which is the first half of the
 * deferral branch's condition. `setPrototypeOf` rather than `new` because the real constructor wants
 * a live client and a raw API payload, and none of that is reachable from the branch under test.
 */
function makeRealCommandInteraction(): ChatInputCommandInteraction {
	return Object.setPrototypeOf(makeInteraction(), ChatInputCommandInteraction.prototype);
}

/** Components take the other half of the branch - they are the only things that can `deferUpdate` */
function makeButtonInteraction(): ButtonInteraction {
	return Object.setPrototypeOf(makeInteraction(), ButtonInteraction.prototype) as unknown as ButtonInteraction;
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

// Every test below the TOS-button one skips TOS entirely so the gate under test is reached directly
function makeGatedHandler(overrides: Partial<CommandHandler> = {}): CommandHandler {
	return makeHandler({ tos_features: [], ...overrides });
}

beforeEach(() => {
	GetUser.mockReset();
	GetUser.mockResolvedValue({ terms_version_accepted: 0 });
	GetGuild.mockReset();
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

	describe('guild_features gate', () => {
		it('passes through when the required feature is present', async () => {
			GetGuild.mockResolvedValue({ features: GUILD_FEATURES.RESTORE_SNAPSHOTS });

			const result = await CheckHandlerAccess(
				makeInteraction(),
				makeGatedHandler({ guild_features: [GUILD_FEATURES.RESTORE_SNAPSHOTS] })
			);

			expect(result).toBeNull();
		});

		it('refuses with "Feature Disabled" when the required feature is absent', async () => {
			GetGuild.mockResolvedValue({ features: 0 });

			const result = await CheckHandlerAccess(
				makeInteraction(),
				makeGatedHandler({ guild_features: [GUILD_FEATURES.RESTORE_SNAPSHOTS] })
			);

			expect(result!.embeds![0].title).toBe('Feature Disabled');
		});

		it('refuses when any one of several required features is missing, not just the first', async () => {
			GetGuild.mockResolvedValue({ features: GUILD_FEATURES.RESTORE_SNAPSHOTS });

			const result = await CheckHandlerAccess(
				makeInteraction(),
				makeGatedHandler({
					guild_features: [GUILD_FEATURES.RESTORE_SNAPSHOTS, GUILD_FEATURES.IMPORT_SNAPSHOTS]
				})
			);

			expect(result!.embeds![0].title).toBe('Feature Disabled');
		});

		it('never calls GetGuild when no guild_features are required', async () => {
			const result = await CheckHandlerAccess(makeInteraction(), makeGatedHandler({ guild_features: [] }));

			expect(result).toBeNull();
			expect(GetGuild).not.toHaveBeenCalled();
		});
	});

	describe('permissions gate', () => {
		it('passes through when the member has every required permission', async () => {
			const interaction = makeInteraction({
				permissions: [DiscordPermissions.ManageChannels, DiscordPermissions.ManageRoles]
			});

			const result = await CheckHandlerAccess(
				interaction,
				makeGatedHandler({ permissions: [DiscordPermissions.ManageChannels, DiscordPermissions.ManageRoles] })
			);

			expect(result).toBeNull();
		});

		it('refuses and lists only the permission the member is missing', async () => {
			const interaction = makeInteraction({ permissions: [DiscordPermissions.ManageChannels] });

			const result = await CheckHandlerAccess(
				interaction,
				makeGatedHandler({ permissions: [DiscordPermissions.ManageChannels, DiscordPermissions.ManageRoles] })
			);

			const description = result!.embeds![0].description as string;
			expect(description).toContain(String(DiscordPermissions.ManageRoles));
			expect(description).not.toContain(String(DiscordPermissions.ManageChannels));
		});

		it('refuses and lists every permission when the member has none of them', async () => {
			const interaction = makeInteraction({ permissions: [] });

			const result = await CheckHandlerAccess(
				interaction,
				makeGatedHandler({ permissions: [DiscordPermissions.ManageChannels, DiscordPermissions.ManageRoles] })
			);

			const description = result!.embeds![0].description as string;
			expect(description).toContain(String(DiscordPermissions.ManageChannels));
			expect(description).toContain(String(DiscordPermissions.ManageRoles));
		});

		it('Administrator bypasses a specific permission requirement it does not literally hold', async () => {
			const interaction = makeInteraction({ permissions: [DiscordPermissions.Administrator] });

			const result = await CheckHandlerAccess(
				interaction,
				makeGatedHandler({ permissions: [DiscordPermissions.BanMembers] })
			);

			expect(result).toBeNull();
		});

		it('never touches interaction.member when no permissions are required', async () => {
			const interaction = makeInteraction(); // member left undefined

			const result = await CheckHandlerAccess(interaction, makeGatedHandler({ permissions: [] }));

			expect(result).toBeNull();
		});
	});

	/**
	 * `response_type` is the only thing standing between a component handler and the message it was
	 * clicked on: `'update'` edits that message in place, `'reply'` leaves it alone. Handlers declare
	 * the value, but this is the code that honours it, and nothing else asserts the mapping.
	 *
	 * It is the framework half of Bug #4 - `restore-safety` and the other buttons sitting on the
	 * public restore step log declare `'reply'` precisely so that pressing one cannot replace the
	 * run's own report with the manage screen, permanently and for everyone.
	 */
	describe('deferral', () => {
		it("defers a 'reply' component as an ephemeral reply, never as an update", async () => {
			const interaction = makeButtonInteraction();

			await CheckHandlerAccess(interaction, makeGatedHandler({ response_type: 'reply', hidden: true }));

			expect(interaction.deferReply).toHaveBeenCalledWith({ flags: 64 });
			expect(interaction.deferUpdate).not.toHaveBeenCalled();
		});

		it("defers a visible 'reply' without the ephemeral flag", async () => {
			const interaction = makeButtonInteraction();

			await CheckHandlerAccess(interaction, makeGatedHandler({ response_type: 'reply', hidden: false }));

			expect(interaction.deferReply).toHaveBeenCalledWith({ flags: undefined });
		});

		it("defers an 'update' component as an update, never as a reply", async () => {
			const interaction = makeButtonInteraction();

			await CheckHandlerAccess(interaction, makeGatedHandler({ response_type: 'update' }));

			expect(interaction.deferUpdate).toHaveBeenCalled();
			expect(interaction.deferReply).not.toHaveBeenCalled();
		});

		it("does not defer a 'modal' handler at all - Discord rejects a modal on a deferred interaction", async () => {
			const interaction = makeButtonInteraction();

			await CheckHandlerAccess(interaction, makeGatedHandler({ response_type: 'modal' }));

			expect(interaction.deferReply).not.toHaveBeenCalled();
			expect(interaction.deferUpdate).not.toHaveBeenCalled();
		});

		it("defers a command as a reply even when it declares 'update' - there is no message to update", async () => {
			const interaction = makeRealCommandInteraction();

			await CheckHandlerAccess(interaction, makeGatedHandler({ response_type: 'update', hidden: true }));

			// The branch is an if/else, so reaching the reply arm is itself proof the update arm was
			// skipped - and a command interaction has no `deferUpdate` to assert on in the first place
			expect(interaction.deferReply).toHaveBeenCalledWith({ flags: 64 });
		});

		// The deferral happens before every gate, so a refusal still has an interaction it can edit
		it('defers before refusing, so the refusal embed has somewhere to land', async () => {
			const interaction = makeButtonInteraction();
			GetGuild.mockResolvedValue({ features: 0 });

			const result = await CheckHandlerAccess(
				interaction,
				makeGatedHandler({ response_type: 'reply', guild_features: [GUILD_FEATURES.RESTORE_SNAPSHOTS] })
			);

			expect(result!.embeds![0].title).toBe('Feature Disabled');
			expect(interaction.deferReply).toHaveBeenCalled();
		});
	});
});
