import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ButtonInteraction, Guild, StringSelectMenuInteraction } from 'discord.js';
import { APIEmbed } from 'discord-api-types/v10';
import {
	COLOR,
	DIFF_CHANGE_TYPE,
	EMOJI,
	RESTORE_OPTION_NAMES,
	RESTORE_OPTIONS,
	RESTORE_PRESETS,
	SNAPSHOT_TYPE
} from '../../Utils/Constants.js';
import { DiscordButton, DiscordButtonStyle, DiscordStringSelect } from '../../Typings/DiscordTypes.js';
import { DiscordPermissions } from '../../Utils/DiscordConstants.js';
import { ButtonHandler, InteractionResponse, SelectMenuHandler } from '../../Typings/HandlerTypes.js';
import { IClient } from '../../Client.js';
import { BOT_ROLE, BOT_USER_ID, EVERYONE, GUILD_ID, channel, makeGuild, makeSnapshot, role } from './Fixtures.js';

/**
 * Screens 01-05 of the restore flow (§12 of the test plan): every handler that only *reads* - the
 * entry menu, the scope toggles, the preview, the action list, the plan download, and the shape of
 * the confirm modal. Nothing here starts a restore; §13/§14 own that half.
 *
 * Handlers return data and never reply (see CLAUDE.md), so each case is a direct
 * `execute(interaction, client, args)` call with assertions on the returned object.
 */

// `Services/RestorePlans.ts` reaches the client through `GuildDiff`'s `MoveBotRoleToTop`
vi.mock('../../Client.js', () => ({
	client: { user: { id: BOT_USER_ID }, channels: { cache: new Map() }, guilds: { cache: new Map() } }
}));

const { GetImportsForGuild } = vi.hoisted(() => ({ GetImportsForGuild: vi.fn() }));
vi.mock('../../CRUD/SnapshotImports.js', () => ({ GetImportsForGuild }));

const { GetSnapshot } = vi.hoisted(() => ({ GetSnapshot: vi.fn() }));
vi.mock('../../CRUD/Snapshots.js', () => ({ GetSnapshot }));

const { IsRestoreRunning } = vi.hoisted(() => ({ IsRestoreRunning: vi.fn() }));
vi.mock('../../Services/RestoreRunner.js', () => ({ IsRestoreRunning }));

const { UploadCDN } = vi.hoisted(() => ({ UploadCDN: vi.fn() }));
vi.mock('../../Utils/UploadCDN.js', () => ({ UploadCDN }));

// Only `DescribeAction`'s saved-message count reaches the DB. Mocked so a stray query is a loud
// failure rather than a hang against a MariaDB that may not be running.
const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('../../Database.js', () => ({ Database: { query } }));

/**
 * `RestorePlanError` is kept real - the preview/actions/plan screens branch on `instanceof`, and a
 * stubbed class would make that branch untestable. `realBuild` keeps the genuine builder reachable
 * for the one case that drives the whole plan pipeline end to end.
 */
const { BuildRestorePlan, GetCachedPlan, real } = vi.hoisted(() => ({
	BuildRestorePlan: vi.fn(),
	GetCachedPlan: vi.fn(),
	real: {} as { build?: typeof import('../../Services/RestorePlans.js')['BuildRestorePlan'], invalidate?: typeof import('../../Services/RestorePlans.js')['InvalidateRestorePlans'] }
}));
vi.mock('../../Services/RestorePlans.js', async (importOriginal) => {
	const actual = await importOriginal<typeof import('../../Services/RestorePlans.js')>();
	real.build = actual.BuildRestorePlan;
	real.invalidate = actual.InvalidateRestorePlans;
	return { ...actual, BuildRestorePlan, GetCachedPlan };
});

const { RestorePlanError } = await import('../../Services/RestorePlans.js');
type RestoreAction = import('../../Services/RestorePlans.js').RestoreAction;
type RestorePlan = import('../../Services/RestorePlans.js').RestorePlan;

const RestoreOptions   = (await import('../../Buttons/Restore/Options.js')).default;
const RestorePreview   = (await import('../../Buttons/Restore/Preview.js')).default;
const RestoreActions   = (await import('../../Buttons/Restore/Actions.js')).default;
const RestorePlanBtn   = (await import('../../Buttons/Restore/Plan.js')).default;
const RestoreConfirm   = (await import('../../Buttons/Restore/Confirm.js')).default;
const RestoreToggle    = (await import('../../Buttons/Restore/Toggle.js')).default;
const RestorePreset    = (await import('../../Menus/RestorePreset.js')).default;
const RestoreCategory  = (await import('../../Menus/RestoreCategory.js')).default;
const { RenderToggleScreen } = await import('../../Buttons/Restore/Toggle.js');
const { FormatCount } = await import('../../Buttons/Restore/Actions.js');

//////////////////
// Helpers
//////////////////

const SNAPSHOT_ID = '5';

type Handler = ButtonHandler | SelectMenuHandler;
type HandlerResult = Awaited<ReturnType<ButtonHandler['execute']>>;

function run(handler: Handler, guild: Guild, args: string[], values: string[] = [], client: IClient = {} as IClient): Promise<HandlerResult> {
	const interaction = { guildId: guild.id, guild, values } as unknown as ButtonInteraction & StringSelectMenuInteraction;
	return (handler as ButtonHandler).execute(interaction, client, args);
}

/** Every §12 handler returns a screen; a modal (`title`) means the wrong branch was taken */
function screen(result: HandlerResult): InteractionResponse {
	if ('title' in result) throw new Error('expected an interaction response, got a modal');
	return result;
}

function embedOf(result: HandlerResult): APIEmbed {
	const embeds = screen(result).embeds;
	if (!embeds || embeds.length === 0) throw new Error('expected an embed');
	return embeds[0];
}

function componentsOf(result: HandlerResult): (DiscordButton | DiscordStringSelect)[] {
	return (screen(result).components ?? []).flatMap(row => row.components as (DiscordButton | DiscordStringSelect)[]);
}

function buttonsOf(result: HandlerResult): DiscordButton[] {
	return componentsOf(result).filter((component): component is DiscordButton => component.type === 2);
}

function selectsOf(result: HandlerResult): DiscordStringSelect[] {
	return componentsOf(result).filter((component): component is DiscordStringSelect => component.type === 3);
}

function customIDs(result: HandlerResult): string[] {
	return buttonsOf(result).map(button => 'custom_id' in button ? button.custom_id : button.url);
}

function planAction(category: RestoreAction['category'], change_type: number, label: string, target_id = 100n, detail: string | null = null): RestoreAction {
	return {
		category,
		change_type,
		target_id,
		label,
		payload: change_type === DIFF_CHANGE_TYPE.DELETE ? null : { id: target_id, permissions: 8n },
		detail
	} as unknown as RestoreAction;
}

function makePlan(actions: RestoreAction[], warnings: string[] = [], mask = RESTORE_PRESETS.FULL): RestorePlan {
	return {
		snapshot_id: SNAPSHOT_ID,
		guild_id: GUILD_ID,
		mask,
		actions,
		warnings,
		fingerprint: 'fingerprint',
		created_at: 0
	};
}

const bareGuild = (): Guild => makeGuild([], []);

beforeEach(() => {
	GetImportsForGuild.mockReset();
	GetImportsForGuild.mockReturnValue(new Map());
	GetSnapshot.mockReset();
	GetSnapshot.mockResolvedValue(makeSnapshot(Number(SNAPSHOT_ID), [], []));
	IsRestoreRunning.mockReset();
	IsRestoreRunning.mockReturnValue(false);
	BuildRestorePlan.mockReset();
	BuildRestorePlan.mockResolvedValue(makePlan([]));
	GetCachedPlan.mockReset();
	GetCachedPlan.mockReturnValue(null);
	UploadCDN.mockReset();
	UploadCDN.mockResolvedValue('lookup-id');
	query.mockReset();
	query.mockResolvedValue([{ count: 0 }]);
});

//////////////////
// Screen 01 - restore-options
//////////////////

describe('Buttons/Restore/Options', () => {
	it('is a hidden reply, so the public snapshot message it was pressed from survives', () => {
		expect(RestoreOptions.response_type).toBe('reply');
		expect(RestoreOptions.hidden).toBe(true);
	});

	it('refuses while a restore is already running, before looking anything up', async () => {
		IsRestoreRunning.mockReturnValue(true);

		const result = await run(RestoreOptions, bareGuild(), [SNAPSHOT_ID]);

		expect(embedOf(result).title).toBe('Restore In Progress');
		expect(GetSnapshot).not.toHaveBeenCalled();
	});

	it('reports a deleted snapshot rather than opening the menu', async () => {
		GetSnapshot.mockResolvedValue(null);

		const result = await run(RestoreOptions, bareGuild(), [SNAPSHOT_ID]);

		expect(embedOf(result).title).toBe('Snapshot Not Found');
		expect(screen(result).components).toBeUndefined();
	});

	it('reports an expired import the same way - the staging cache is empty and there is no stored row', async () => {
		GetImportsForGuild.mockReturnValue(new Map());
		GetSnapshot.mockResolvedValue(null);

		const result = await run(RestoreOptions, bareGuild(), ['EXPT-0000']);

		expect(embedOf(result).title).toBe('Snapshot Not Found');
	});

	it('refuses when the bot holds none of the three permissions, naming all three', async () => {
		const guild = makeGuild([], [], { permissions: [] });

		const result = await run(RestoreOptions, guild, [SNAPSHOT_ID]);

		expect(embedOf(result).title).toBe('Missing Permissions');
		expect(embedOf(result).description).toContain('**Missing:** `Manage Channels`, `Manage Roles`, `Ban Members`');
	});

	// Bug #13: the check used to pass on *any* one of the three, so a bot holding only Ban Members
	// walked the whole flow and then failed every channel and role action mid-run
	it('refuses when only one permission is missing, and names exactly that one', async () => {
		const guild = makeGuild([], [], { permissions: [DiscordPermissions.ManageChannels, DiscordPermissions.BanMembers] });

		const result = await run(RestoreOptions, guild, [SNAPSHOT_ID]);

		expect(embedOf(result).title).toBe('Missing Permissions');
		const missingLine = embedOf(result).description!.split('\n').find(line => line.startsWith('**Missing:**'))!;
		expect(missingLine).toBe('**Missing:** `Manage Roles`');
	});

	it('opens the preset menu when all three permissions are held', async () => {
		const result = await run(RestoreOptions, bareGuild(), [SNAPSHOT_ID]);

		const [dropdown] = selectsOf(result);
		expect(dropdown.custom_id).toBe(`restore-preset_${SNAPSHOT_ID}`);
		expect(dropdown.options.map(option => option.value)).toEqual(['full', 'structure', 'bans', 'custom']);
		expect(embedOf(result).title).toBe(`Restore Snapshot #${SNAPSHOT_ID}`);
		expect(embedOf(result).description).toContain('This is destructive.');
	});

	it('prefers a staged import over a stored snapshot, and calls it an import', async () => {
		const imported = { id: 'ABCD-0000', type: SNAPSHOT_TYPE.IMPORT, expires_at: 0 };
		GetImportsForGuild.mockReturnValue(new Map([['ABCD-0000', imported]]));

		const result = await run(RestoreOptions, bareGuild(), ['ABCD-0000']);

		expect(GetSnapshot).not.toHaveBeenCalled();
		expect(embedOf(result).title).toBe('Restore Import #ABCD-0000');
		expect(embedOf(result).description).toContain('match this import');
	});

	it('warns on the entry screen that an import may be cross-guild, but a stored snapshot does not', async () => {
		const imported = { id: 'ABCD-0000', type: SNAPSHOT_TYPE.IMPORT, expires_at: 0 };
		GetImportsForGuild.mockReturnValue(new Map([['ABCD-0000', imported]]));

		const importResult = await run(RestoreOptions, bareGuild(), ['ABCD-0000']);
		expect(embedOf(importResult).description).toContain('different server');

		const snapshotResult = await run(RestoreOptions, bareGuild(), [SNAPSHOT_ID]);
		expect(embedOf(snapshotResult).description).not.toContain('different server');
	});
});

//////////////////
// Handler metadata across the whole flow
//////////////////

describe('restore handler metadata', () => {
	it('keeps every screen ephemeral', async () => {
		const barrel = await import('../../Buttons/Restore/index.js');
		const menus = await import('../../Menus/index.js');

		const handlers: Handler[] = [
			...Object.values(barrel),
			menus.RestorePreset,
			menus.RestoreCategory
		];

		for (const handler of handlers) {
			// `hidden` is only read when deferring, and a modal never defers - `restore-confirm`
			// leaves it false like the other two modal buttons in this codebase
			if (handler.response_type === 'modal') continue;

			expect.soft(handler.hidden, `${handler.customID} must be ephemeral`).toBe(true);
		}
	});

	/**
	 * The plan's line reads "every restore handler is 'update' + hidden except restore-stop and
	 * restore-log". Two more are deliberate exceptions, both documented in their own files:
	 * `restore-confirm` is a modal (it has no deferred reply to fall back on), and `restore-safety`
	 * replies because updating would replace the public step log with the manage screen.
	 */
	it('updates in place except where replacing the message would destroy something', async () => {
		const barrel = await import('../../Buttons/Restore/index.js');
		const menus = await import('../../Menus/index.js');

		const responseTypes = Object.fromEntries(
			[...Object.values(barrel), menus.RestorePreset, menus.RestoreCategory]
				.map(handler => [handler.customID, handler.response_type])
		);

		expect(responseTypes).toEqual({
			'restore-options' : 'reply',  // pressed from the public snapshot message
			'restore-stop'    : 'reply',  // the runner owns the step log and re-renders it on a timer
			'restore-log'     : 'reply',
			'restore-safety'  : 'reply',  // Bug #4 - updating would consume the run's own report
			'restore-retry'   : 'reply',
			'restore-confirm' : 'modal',
			'restore-toggle'  : 'update',
			'restore-preview' : 'update',
			'restore-actions' : 'update',
			'restore-plan'    : 'update',
			'restore-preset'  : 'update',
			'restore-category': 'update'
		});
	});
});

//////////////////
// Screen 02/03 - restore-preset, restore-toggle
//////////////////

describe('Menus/RestorePreset', () => {
	function clientWithPreview(): { client: IClient, preview: ReturnType<typeof vi.fn> } {
		const preview = vi.fn().mockResolvedValue({ embeds: [{ title: 'Restore Preview' }] });
		const client = { buttons: new Map([['restore-preview', { execute: preview }]]) } as unknown as IClient;
		return { client, preview };
	}

	it.each([
		['full'     , RESTORE_PRESETS.FULL     , 7],
		['structure', RESTORE_PRESETS.STRUCTURE, 3],
		['bans'     , RESTORE_PRESETS.BANS     , 4]
	])('maps the %s preset to mask %i', async (preset, mask, expected) => {
		expect(mask).toBe(expected);

		const { client, preview } = clientWithPreview();
		await run(RestorePreset, bareGuild(), [SNAPSHOT_ID], [preset], client);

		expect(preview).toHaveBeenCalledWith(expect.anything(), client, [SNAPSHOT_ID, String(expected)]);
	});

	it('routes Custom to the toggle screen at mask 0 without building a preview', async () => {
		const { client, preview } = clientWithPreview();

		const result = await run(RestorePreset, bareGuild(), [SNAPSHOT_ID], ['custom'], client);

		expect(preview).not.toHaveBeenCalled();
		expect(embedOf(result).title).toBe('Custom Restore Scope');
		expect(customIDs(result)).toContain(`restore-preview_${SNAPSHOT_ID}_0`);
	});

	it('falls back to mask 0 on an unknown preset rather than throwing', async () => {
		const { client, preview } = clientWithPreview();

		await run(RestorePreset, bareGuild(), [SNAPSHOT_ID], ['not-a-preset'], client);

		expect(preview).toHaveBeenCalledWith(expect.anything(), client, [SNAPSHOT_ID, '0']);
	});
});

describe('Buttons/Restore/Toggle', () => {
	function toggleButtons(mask: number): DiscordButton[] {
		return buttonsOf(RenderToggleScreen(SNAPSHOT_ID, mask) as HandlerResult);
	}

	it('styles set bits SUCCESS and clear bits SECONDARY', () => {
		const [channels, roles, bans] = toggleButtons(RESTORE_OPTIONS.CHANNELS | RESTORE_OPTIONS.BANS);

		expect(channels.style).toBe(DiscordButtonStyle.SUCCESS);
		expect(roles.style).toBe(DiscordButtonStyle.SECONDARY);
		expect(bans.style).toBe(DiscordButtonStyle.SUCCESS);
	});

	it('keeps Messages disabled and SECONDARY even when its bit is set - it is not implemented', () => {
		const messages = toggleButtons(RESTORE_OPTIONS.MESSAGES).find(button => button.label === RESTORE_OPTION_NAMES[RESTORE_OPTIONS.MESSAGES])!;

		expect(messages.style).toBe(DiscordButtonStyle.SECONDARY);
		expect(messages.disabled).toBe(true);
	});

	it('disables Preview at mask 0 and enables it at any non-zero mask', () => {
		const preview = (mask: number) => toggleButtons(mask).find(button => 'custom_id' in button && button.custom_id.startsWith('restore-preview'))!;

		expect(preview(0).disabled).toBe(true);
		expect(preview(RESTORE_OPTIONS.BANS).disabled).toBe(false);
	});

	it('XORs the pressed bit out of the mask and carries the new mask into every child', async () => {
		// 5 = channels + bans; pressing bans leaves channels
		const result = await run(RestoreToggle, bareGuild(), [SNAPSHOT_ID, '5', String(RESTORE_OPTIONS.BANS)]);

		expect(customIDs(result)).toEqual([
			`restore-toggle_${SNAPSHOT_ID}_1_1`,
			`restore-toggle_${SNAPSHOT_ID}_1_2`,
			`restore-toggle_${SNAPSHOT_ID}_1_4`,
			`restore-toggle_${SNAPSHOT_ID}_1_8`,
			`restore-preview_${SNAPSHOT_ID}_1`
		]);
	});

	it('XORs a clear bit back on', async () => {
		const result = await run(RestoreToggle, bareGuild(), [SNAPSHOT_ID, '1', String(RESTORE_OPTIONS.ROLES)]);

		expect(customIDs(result)).toContain(`restore-preview_${SNAPSHOT_ID}_3`);
	});
});

//////////////////
// Screen 04 - restore-preview
//////////////////

describe('Buttons/Restore/Preview', () => {
	const channelDelete = planAction(RESTORE_OPTIONS.CHANNELS, DIFF_CHANGE_TYPE.DELETE, '#general', 10n);
	const channelCreate = planAction(RESTORE_OPTIONS.CHANNELS, DIFF_CHANGE_TYPE.CREATE, '#rules', 11n);
	const roleUpdate    = planAction(RESTORE_OPTIONS.ROLES   , DIFF_CHANGE_TYPE.UPDATE, '@Mod'  , 20n);

	it('reports a missing snapshot without building a plan', async () => {
		GetSnapshot.mockResolvedValue(null);

		const result = await run(RestorePreview, bareGuild(), [SNAPSHOT_ID, '7']);

		expect(embedOf(result).title).toBe('Snapshot Not Found');
		expect(BuildRestorePlan).not.toHaveBeenCalled();
	});

	it('renders a RestorePlanError as an embed, never a stack trace', async () => {
		BuildRestorePlan.mockRejectedValue(new RestorePlanError('this snapshot has no role matching this bot'));

		const result = await run(RestorePreview, bareGuild(), [SNAPSHOT_ID, '7']);

		expect(embedOf(result).title).toBe('Could Not Build Restore Plan');
		expect(embedOf(result).description).toBe('this snapshot has no role matching this bot');
	});

	it('rethrows anything that is not a RestorePlanError', async () => {
		BuildRestorePlan.mockRejectedValue(new TypeError('boom'));

		await expect(run(RestorePreview, bareGuild(), [SNAPSHOT_ID, '7'])).rejects.toThrow('boom');
	});

	it('totals the actions and the destructive subset', async () => {
		BuildRestorePlan.mockResolvedValue(makePlan([channelDelete, channelCreate, roleUpdate]));

		const result = await run(RestorePreview, bareGuild(), [SNAPSHOT_ID, '7']);

		expect(embedOf(result).description).toContain('**3** actions would be applied (**1** destructive).');
	});

	it('says nothing to restore and disables both buttons at zero actions', async () => {
		BuildRestorePlan.mockResolvedValue(makePlan([]));

		const result = await run(RestorePreview, bareGuild(), [SNAPSHOT_ID, '7']);

		expect(embedOf(result).description).toBe('Nothing to restore for this scope - the server already matches.');
		expect(buttonsOf(result).map(button => button.disabled)).toEqual([true, true]);
		expect(buttonsOf(result)[1].label).toBe('Nothing to restore');
		expect(selectsOf(result)).toHaveLength(0);
	});

	it('labels the confirm button with the action count and points it at restore-confirm', async () => {
		BuildRestorePlan.mockResolvedValue(makePlan([channelDelete]));

		const result = await run(RestorePreview, bareGuild(), [SNAPSHOT_ID, '7']);

		expect(buttonsOf(result)[1].label).toBe('Restore - 1 action');
		expect(customIDs(result)).toEqual([`restore-plan_${SNAPSHOT_ID}_7`, `restore-confirm_${SNAPSHOT_ID}_7`]);
	});

	it('lists only categories in the mask that actually have actions', async () => {
		BuildRestorePlan.mockResolvedValue(makePlan([channelDelete, roleUpdate]));

		const [dropdown] = selectsOf(await run(RestorePreview, bareGuild(), [SNAPSHOT_ID, '7']));

		expect(dropdown.options.map(option => option.label)).toEqual([
			RESTORE_OPTION_NAMES[RESTORE_OPTIONS.CHANNELS],
			RESTORE_OPTION_NAMES[RESTORE_OPTIONS.ROLES]
		]);
		expect(dropdown.options[0].description).toBe('1 action · 1 destructive');
		expect(dropdown.options[1].description).toBe('1 action · 0 destructive');
	});

	it('omits a category the mask excludes even when the plan somehow holds one', async () => {
		BuildRestorePlan.mockResolvedValue(makePlan([channelDelete, roleUpdate], [], RESTORE_OPTIONS.ROLES));

		const [dropdown] = selectsOf(await run(RestorePreview, bareGuild(), [SNAPSHOT_ID, String(RESTORE_OPTIONS.ROLES)]));

		expect(dropdown.options.map(option => option.label)).toEqual([RESTORE_OPTION_NAMES[RESTORE_OPTIONS.ROLES]]);
	});

	it('renders plan warnings under a warning heading', async () => {
		BuildRestorePlan.mockResolvedValue(makePlan([roleUpdate], ['@Mod is at or above my highest role - this change may fail.']));

		const result = await run(RestorePreview, bareGuild(), [SNAPSHOT_ID, '7']);

		expect(embedOf(result).description).toContain(`${EMOJI.WARNING} **Warnings**\n- @Mod is at or above my highest role`);
	});

	// A hierarchy warning is emitted per role at or above the bot, so a server that placed the bot
	// low can produce dozens - unbounded, they alone overflow the 4096 character embed limit
	it('summarises past ten warnings instead of listing every one', async () => {
		BuildRestorePlan.mockResolvedValue(makePlan([roleUpdate], Array.from({ length: 14 }, (_, index) => `warning ${index}`)));

		const description = embedOf(await run(RestorePreview, bareGuild(), [SNAPSHOT_ID, '7'])).description!;

		expect(description).toContain('- warning 9');
		expect(description).not.toContain('- warning 10');
		expect(description).toContain('- ...and 4 more warnings');
	});

	it('keeps the overflow line singular for a single hidden warning', async () => {
		BuildRestorePlan.mockResolvedValue(makePlan([roleUpdate], Array.from({ length: 11 }, (_, index) => `warning ${index}`)));

		const description = embedOf(await run(RestorePreview, bareGuild(), [SNAPSHOT_ID, '7'])).description!;

		expect(description.endsWith('- ...and 1 more warning')).toBe(true);
	});

	// Bug #10 - the counts used to live only inside the (initially closed) category dropdown
	describe('breakdown and destructive callout', () => {
		it('breaks each category down by change type, channels then roles then bans', async () => {
			BuildRestorePlan.mockResolvedValue(makePlan([
				channelCreate, channelDelete, roleUpdate,
				planAction(RESTORE_OPTIONS.BANS, DIFF_CHANGE_TYPE.CREATE, '<@30>', 30n)
			]));

			const description = embedOf(await run(RestorePreview, bareGuild(), [SNAPSHOT_ID, '7'])).description!;
			const lines = description.split('\n').filter(line => line.includes('`+'));

			expect(lines).toEqual([
				`${RESTORE_OPTION_NAMES[RESTORE_OPTIONS.CHANNELS]} \`+1 ~0 −1\``,
				`${RESTORE_OPTION_NAMES[RESTORE_OPTIONS.ROLES   ]} \`+0 ~1 −0\``,
				`${RESTORE_OPTION_NAMES[RESTORE_OPTIONS.BANS    ]} \`+1 ~0 −0\``
			]);
		});

		it('skips a category with no actions instead of printing a row of zeroes', async () => {
			BuildRestorePlan.mockResolvedValue(makePlan([roleUpdate]));

			const description = embedOf(await run(RestorePreview, bareGuild(), [SNAPSHOT_ID, '7'])).description!;

			expect(description).toContain(`${RESTORE_OPTION_NAMES[RESTORE_OPTIONS.ROLES]} \`+0 ~1 −0\``);
			expect(description).not.toContain(RESTORE_OPTION_NAMES[RESTORE_OPTIONS.CHANNELS]);
		});

		it('names what gets deleted, and warns that channel history goes with it', async () => {
			BuildRestorePlan.mockResolvedValue(makePlan([channelDelete, planAction(RESTORE_OPTIONS.ROLES, DIFF_CHANGE_TYPE.DELETE, '@Mod', 20n)]));

			const description = embedOf(await run(RestorePreview, bareGuild(), [SNAPSHOT_ID, '7'])).description!;

			expect(description).toContain('🚩 **2 destructive actions** - these are deleted, not archived');
			expect(description).toContain('#general, @Mod');
			expect(description).toContain('Deleting a channel takes its saved message history with it.');
		});

		it('drops the message-history line when nothing being deleted is a channel', async () => {
			BuildRestorePlan.mockResolvedValue(makePlan([planAction(RESTORE_OPTIONS.BANS, DIFF_CHANGE_TYPE.DELETE, '<@30>', 30n)]));

			const description = embedOf(await run(RestorePreview, bareGuild(), [SNAPSHOT_ID, '7'])).description!;

			expect(description).toContain('🚩 **1 destructive action** - these are deleted, not archived');
			expect(description).not.toContain('saved message history');
		});

		it('summarises past ten names rather than pasting every label into the embed', async () => {
			const deletes = Array.from({ length: 14 }, (_, index) =>
				planAction(RESTORE_OPTIONS.CHANNELS, DIFF_CHANGE_TYPE.DELETE, `#channel-${index}`, BigInt(index)));
			BuildRestorePlan.mockResolvedValue(makePlan(deletes));

			const description = embedOf(await run(RestorePreview, bareGuild(), [SNAPSHOT_ID, '7'])).description!;

			expect(description).toContain('#channel-9, and 4 more');
			expect(description).not.toContain('#channel-10');
		});

		it('says nothing extra when there is nothing to restore', async () => {
			BuildRestorePlan.mockResolvedValue(makePlan([]));

			const description = embedOf(await run(RestorePreview, bareGuild(), [SNAPSHOT_ID, '7'])).description!;

			expect(description).not.toContain('🚩');
			expect(description).not.toContain('`+');
		});

		it('stays inside the 4096 character embed description limit at its worst', async () => {
			// 100-character labels (Discord's channel name cap is 100) across all three categories,
			// every warning the plan can emit, and enough deletes to overflow the named list
			const label = '#' + 'x'.repeat(99);
			const actions = [
				...Array.from({ length: 60 }, (_, index) => planAction(RESTORE_OPTIONS.CHANNELS, DIFF_CHANGE_TYPE.DELETE, label, BigInt(index))),
				...Array.from({ length: 60 }, (_, index) => planAction(RESTORE_OPTIONS.ROLES, DIFF_CHANGE_TYPE.DELETE, label, BigInt(1000 + index))),
				...Array.from({ length: 60 }, (_, index) => planAction(RESTORE_OPTIONS.BANS, DIFF_CHANGE_TYPE.DELETE, label, BigInt(2000 + index)))
			];
			const warnings = Array.from({ length: 20 }, () => `${label} is at or above my highest role - this change may fail.`);
			BuildRestorePlan.mockResolvedValue(makePlan(actions, warnings));

			const description = embedOf(await run(RestorePreview, bareGuild(), [SNAPSHOT_ID, '7'])).description!;

			expect(description.length).toBeLessThan(4096);
		});
	});

	it('agrees with a plan built by the real builder, not just a shaped mock', async () => {
		const guild = makeGuild([BOT_ROLE, EVERYONE, role(5n, 'Mod')], [channel(10n, 'general', 0, null)]);
		GetSnapshot.mockResolvedValue(makeSnapshot(Number(SNAPSHOT_ID), [BOT_ROLE, EVERYONE], []));
		BuildRestorePlan.mockImplementation(real.build!);
		real.invalidate!(guild.id);

		const description = embedOf(await run(RestorePreview, guild, [SNAPSHOT_ID, '7'])).description!;

		// Nothing in the snapshot, everything in the guild - so both live entities are deletes
		expect(description).toContain('**2** actions would be applied (**2** destructive).');
		expect(description).toContain(`${RESTORE_OPTION_NAMES[RESTORE_OPTIONS.CHANNELS]} \`+0 ~0 −1\``);
		expect(description).toContain(`${RESTORE_OPTION_NAMES[RESTORE_OPTIONS.ROLES   ]} \`+0 ~0 −1\``);
		expect(description).toContain('#general');
		expect(description).toContain('@Mod');

		real.invalidate!(guild.id);
	});
});

//////////////////
// Screen 05 - restore-actions
//////////////////

describe('Buttons/Restore/Actions', () => {
	const CHANNELS = String(RESTORE_OPTIONS.CHANNELS);

	/** `n` channel actions, every third one a DELETE, so the destructive filter has something to cut */
	function manyActions(count: number): RestoreAction[] {
		return Array.from({ length: count }, (_, index) => planAction(
			RESTORE_OPTIONS.CHANNELS,
			index % 3 === 0 ? DIFF_CHANGE_TYPE.DELETE : DIFF_CHANGE_TYPE.UPDATE,
			`#channel-${index}`,
			BigInt(index)
		));
	}

	function pageLabel(result: HandlerResult): string {
		return buttonsOf(result).find(button => button.label?.startsWith('Page '))!.label!;
	}

	it.each([
		['0'    , 'Page 1 / 3'],
		['1'    , 'Page 2 / 3'],
		['99'   , 'Page 3 / 3'],
		['last' , 'Page 3 / 3'],
		['first', 'Page 1 / 3']
	])('clamps a requested page of %s', async (pageArg, expected) => {
		BuildRestorePlan.mockResolvedValue(makePlan(manyActions(25)));

		const result = await run(RestoreActions, bareGuild(), [SNAPSHOT_ID, '7', CHANNELS, pageArg, '']);

		expect(pageLabel(result)).toBe(expected);
	});

	it('does not page into the negatives on an empty list', async () => {
		BuildRestorePlan.mockResolvedValue(makePlan([]));

		const result = await run(RestoreActions, bareGuild(), [SNAPSHOT_ID, '7', CHANNELS, '0', '']);

		expect(pageLabel(result)).toBe('Page 1 / 1');
		expect(embedOf(result).description).toBe('No actions to display on this page.');
	});

	it('disables first/previous on the first page and next/last on the last', async () => {
		BuildRestorePlan.mockResolvedValue(makePlan(manyActions(25)));

		const first = buttonsOf(await run(RestoreActions, bareGuild(), [SNAPSHOT_ID, '7', CHANNELS, '0', '']));
		const last  = buttonsOf(await run(RestoreActions, bareGuild(), [SNAPSHOT_ID, '7', CHANNELS, 'last', '']));

		expect(first.slice(0, 5).map(button => button.disabled)).toEqual([true, true, true, false, false]);
		expect(last .slice(0, 5).map(button => button.disabled)).toEqual([false, false, true, true, true]);
	});

	it('fills a full page and only the remainder on the last one', async () => {
		BuildRestorePlan.mockResolvedValue(makePlan(manyActions(25)));

		const full = embedOf(await run(RestoreActions, bareGuild(), [SNAPSHOT_ID, '7', CHANNELS, '0', ''])).description!;
		const tail = embedOf(await run(RestoreActions, bareGuild(), [SNAPSHOT_ID, '7', CHANNELS, 'last', ''])).description!;

		expect(full.split('\n')).toHaveLength(10);
		expect(tail.split('\n')).toHaveLength(5);
		expect(full.split('\n')[0]).toBe('− #channel-0');
		expect(full.split('\n')[1]).toBe('~ #channel-1');
	});

	it('filters to destructive actions, resets to page 0 and turns the button SUCCESS', async () => {
		BuildRestorePlan.mockResolvedValue(makePlan(manyActions(25)));

		const result = await run(RestoreActions, bareGuild(), [SNAPSHOT_ID, '7', CHANNELS, '2', 'destructive']);
		const filterButton = buttonsOf(result).find(button => button.label === 'Destructive only')!;

		expect(embedOf(result).description!.split('\n').every(line => line.startsWith('−'))).toBe(true);
		expect(pageLabel(result)).toBe('Page 1 / 1');
		expect(filterButton.style).toBe(DiscordButtonStyle.SUCCESS);
		// pressing it again clears the filter, and every page link keeps carrying it while it is on
		expect('custom_id' in filterButton && filterButton.custom_id).toBe(`restore-actions_${SNAPSHOT_ID}_7_${CHANNELS}_0_`);
		expect(customIDs(result)[0]).toBe(`restore-actions_${SNAPSHOT_ID}_7_${CHANNELS}_first_destructive`);
	});

	it('renders an empty filtered result rather than an empty embed', async () => {
		BuildRestorePlan.mockResolvedValue(makePlan([planAction(RESTORE_OPTIONS.CHANNELS, DIFF_CHANGE_TYPE.UPDATE, '#rules', 11n)]));

		const result = await run(RestoreActions, bareGuild(), [SNAPSHOT_ID, '7', CHANNELS, '0', 'destructive']);

		expect(embedOf(result).description).toBe('No actions to display on this page.');
		expect(pageLabel(result)).toBe('Page 1 / 1');
	});

	it('round-trips its own trailing empty filter segment through customId.split', async () => {
		BuildRestorePlan.mockResolvedValue(makePlan(manyActions(5)));

		const result = await run(RestoreActions, bareGuild(), [SNAPSHOT_ID, '7', CHANNELS, '0', '']);
		const firstPageID = customIDs(result)[0];

		// GlobalHandler splits the customId on '_' into name + args
		const [name, ...args] = firstPageID.split('_');
		expect(name).toBe('restore-actions');
		expect(args[4]).toBe('');

		const reentered = await run(RestoreActions, bareGuild(), args);
		const filterButton = buttonsOf(reentered).find(button => button.label === 'Destructive only')!;
		expect(filterButton.style).toBe(DiscordButtonStyle.SECONDARY);
	});

	it('is read-only - the confirm button lives on the preview and only there', async () => {
		BuildRestorePlan.mockResolvedValue(makePlan(manyActions(25)));

		const result = await run(RestoreActions, bareGuild(), [SNAPSHOT_ID, '7', CHANNELS, '0', '']);

		expect(customIDs(result).some(id => id.startsWith('restore-confirm'))).toBe(false);
		expect(customIDs(result)).toContain(`restore-preview_${SNAPSHOT_ID}_7`);
	});

	it('reports a missing snapshot without building a plan', async () => {
		GetSnapshot.mockResolvedValue(null);

		const result = await run(RestoreActions, bareGuild(), [SNAPSHOT_ID, '7', CHANNELS, '0', '']);

		expect(embedOf(result).title).toBe('Snapshot Not Found');
		expect(BuildRestorePlan).not.toHaveBeenCalled();
	});

	it('renders a RestorePlanError as an embed', async () => {
		BuildRestorePlan.mockRejectedValue(new RestorePlanError('nope'));

		const result = await run(RestoreActions, bareGuild(), [SNAPSHOT_ID, '7', CHANNELS, '0', '']);

		expect(embedOf(result).title).toBe('Could Not Build Restore Plan');
	});

	it('appends the field-change detail to an UPDATE line (Bug #11)', async () => {
		BuildRestorePlan.mockResolvedValue(makePlan([
			planAction(RESTORE_OPTIONS.CHANNELS, DIFF_CHANGE_TYPE.UPDATE, '#rules', 11n, 'topic, 1 overwrite')
		]));

		const result = await run(RestoreActions, bareGuild(), [SNAPSHOT_ID, '7', CHANNELS, '0', '']);

		expect(embedOf(result).description).toBe('~ #rules · topic, 1 overwrite');
	});

	it('renders a bare UPDATE line when there is no detail to show', async () => {
		BuildRestorePlan.mockResolvedValue(makePlan([
			planAction(RESTORE_OPTIONS.CHANNELS, DIFF_CHANGE_TYPE.UPDATE, '#rules', 11n)
		]));

		const result = await run(RestoreActions, bareGuild(), [SNAPSHOT_ID, '7', CHANNELS, '0', '']);

		expect(embedOf(result).description).toBe('~ #rules');
	});

	it('never appends detail to a CREATE or DELETE line', async () => {
		BuildRestorePlan.mockResolvedValue(makePlan([
			planAction(RESTORE_OPTIONS.CHANNELS, DIFF_CHANGE_TYPE.CREATE, '#new', 12n, 'should not appear'),
			planAction(RESTORE_OPTIONS.CHANNELS, DIFF_CHANGE_TYPE.DELETE, '#gone', 13n, 'should not appear')
		]));

		const result = await run(RestoreActions, bareGuild(), [SNAPSHOT_ID, '7', CHANNELS, '0', '']);

		expect(embedOf(result).description).not.toContain('should not appear');
	});

	describe('saved-message counts', () => {
		it('annotates a channel delete with what would be lost', async () => {
			BuildRestorePlan.mockResolvedValue(makePlan([planAction(RESTORE_OPTIONS.CHANNELS, DIFF_CHANGE_TYPE.DELETE, '#general', 10n)]));
			query.mockResolvedValue([{ count: 3200 }]);

			const result = await run(RestoreActions, bareGuild(), [SNAPSHOT_ID, '7', CHANNELS, '0', '']);

			expect(embedOf(result).description).toBe('− #general · 3.2k saved messages');
			expect(query).toHaveBeenCalledWith(expect.stringContaining('FROM Messages'), [10n]);
		});

		it('leaves a delete bare when nothing was ever saved', async () => {
			BuildRestorePlan.mockResolvedValue(makePlan([planAction(RESTORE_OPTIONS.CHANNELS, DIFF_CHANGE_TYPE.DELETE, '#general', 10n)]));
			query.mockResolvedValue([{ count: 0 }]);

			const result = await run(RestoreActions, bareGuild(), [SNAPSHOT_ID, '7', CHANNELS, '0', '']);

			expect(embedOf(result).description).toBe('− #general');
		});

		it('says "message" for a single one', async () => {
			BuildRestorePlan.mockResolvedValue(makePlan([planAction(RESTORE_OPTIONS.CHANNELS, DIFF_CHANGE_TYPE.DELETE, '#general', 10n)]));
			query.mockResolvedValue([{ count: 1 }]);

			const result = await run(RestoreActions, bareGuild(), [SNAPSHOT_ID, '7', CHANNELS, '0', '']);

			expect(embedOf(result).description).toBe('− #general · 1 saved message');
		});

		it('does not count messages for anything that is not a channel delete', async () => {
			BuildRestorePlan.mockResolvedValue(makePlan([
				planAction(RESTORE_OPTIONS.CHANNELS, DIFF_CHANGE_TYPE.UPDATE, '#rules', 11n),
				planAction(RESTORE_OPTIONS.CHANNELS, DIFF_CHANGE_TYPE.CREATE, '#new'  , 12n)
			]));

			await run(RestoreActions, bareGuild(), [SNAPSHOT_ID, '7', CHANNELS, '0', '']);

			expect(query).not.toHaveBeenCalled();
		});
	});

	describe('FormatCount', () => {
		it.each([
			[0, '0'],
			[999, '999'],
			[1000, '1.0k'],
			[3200, '3.2k'],
			[1_250_000, '1250.0k']
		])('formats %i as %s', (input, expected) => {
			expect(FormatCount(input)).toBe(expected);
		});
	});
});

//////////////////
// Menus/RestoreCategory
//////////////////

describe('Menus/RestoreCategory', () => {
	it('opens the action list at page 0 with no filter', async () => {
		const actions = vi.fn().mockResolvedValue({ embeds: [{ title: 'Restore Actions' }] });
		const client = { buttons: new Map([['restore-actions', { execute: actions }]]) } as unknown as IClient;

		await run(RestoreCategory, bareGuild(), [SNAPSHOT_ID, '7'], [String(RESTORE_OPTIONS.ROLES)], client);

		expect(actions).toHaveBeenCalledWith(expect.anything(), client, [SNAPSHOT_ID, '7', String(RESTORE_OPTIONS.ROLES), '0', '']);
	});
});

//////////////////
// Screen 06 - the confirm modal's shape (its submit lives in Modals/RestoreStart.ts)
//////////////////

describe('Buttons/Restore/Confirm', () => {
	function modal(result: HandlerResult) {
		if (!('title' in result)) throw new Error('expected a modal');
		return result;
	}

	it('carries the snapshot and mask into the modal submit', async () => {
		GetCachedPlan.mockReturnValue(makePlan([planAction(RESTORE_OPTIONS.ROLES, DIFF_CHANGE_TYPE.UPDATE, '@Mod', 20n)]));

		const result = modal(await run(RestoreConfirm, bareGuild(), [SNAPSHOT_ID, '7']));

		expect(result.custom_id).toBe(`restore-start_${SNAPSHOT_ID}_7`);
		expect(result.title).toBe('Confirm restore - 1 action');
	});

	it('still opens on an expired cache, with a generic title', async () => {
		GetCachedPlan.mockReturnValue(null);
		const guild = makeGuild([], []);
		Object.assign(guild, { name: 'Test Guild' });

		const result = modal(await run(RestoreConfirm, guild, [SNAPSHOT_ID, '7']));

		expect(result.title).toBe('Confirm restore');
		expect(result.components[0]).toMatchObject({ label: 'Server name' });
	});

	it('names the destructive count when there is one', async () => {
		GetCachedPlan.mockReturnValue(makePlan([planAction(RESTORE_OPTIONS.CHANNELS, DIFF_CHANGE_TYPE.DELETE, '#general', 10n)]));
		const guild = makeGuild([], []);
		Object.assign(guild, { name: 'Test Guild' });

		const result = modal(await run(RestoreConfirm, guild, [SNAPSHOT_ID, '7']));

		expect(result.components[0]).toMatchObject({ description: '1 destructive. Type: Test Guild' });
	});

	it('truncates to Discord\'s modal limits on a 100 character guild name', async () => {
		GetCachedPlan.mockReturnValue(makePlan(Array.from({ length: 1234 }, () => planAction(RESTORE_OPTIONS.CHANNELS, DIFF_CHANGE_TYPE.DELETE, '#general', 10n))));
		const guild = makeGuild([], []);
		Object.assign(guild, { name: 'G'.repeat(100) });

		const result = modal(await run(RestoreConfirm, guild, [SNAPSHOT_ID, '7']));

		expect(result.title.length).toBeLessThanOrEqual(45);
		const label = result.components[0] as unknown as { description: string };
		expect(label.description.length).toBeLessThanOrEqual(100);
	});
});

//////////////////
// restore-plan (download)
//////////////////

describe('Buttons/Restore/Plan', () => {
	it('uploads a parseable, bigint-safe plan as a single-download file', async () => {
		BuildRestorePlan.mockResolvedValue(makePlan([planAction(RESTORE_OPTIONS.ROLES, DIFF_CHANGE_TYPE.UPDATE, '@Mod', 20n)]));

		const result = await run(RestorePlanBtn, bareGuild(), [SNAPSHOT_ID, '7']);

		const [fileName, buffer, downloadLimit] = UploadCDN.mock.calls[0] as [string, Buffer, number];
		expect(fileName).toBe(`restore-plan-${SNAPSHOT_ID}.json`);
		expect(downloadLimit).toBe(1);

		const parsed = JSON.parse(buffer.toString('utf8')) as RestorePlan;
		expect(parsed.actions[0].target_id).toBe('20');
		expect(parsed.actions[0].payload).toMatchObject({ permissions: '8' });
		expect(embedOf(result).description).toContain('**Actions:** 1');
	});

	it('reports a missing snapshot without uploading anything', async () => {
		GetSnapshot.mockResolvedValue(null);

		const result = await run(RestorePlanBtn, bareGuild(), [SNAPSHOT_ID, '7']);

		expect(embedOf(result).title).toBe('Snapshot Not Found');
		expect(UploadCDN).not.toHaveBeenCalled();
	});

	it('renders a RestorePlanError as an embed', async () => {
		BuildRestorePlan.mockRejectedValue(new RestorePlanError('nope'));

		const result = await run(RestorePlanBtn, bareGuild(), [SNAPSHOT_ID, '7']);

		expect(embedOf(result).title).toBe('Could Not Build Restore Plan');
		expect(embedOf(result).color).toBe(COLOR.ERROR);
		expect(UploadCDN).not.toHaveBeenCalled();
	});
});
