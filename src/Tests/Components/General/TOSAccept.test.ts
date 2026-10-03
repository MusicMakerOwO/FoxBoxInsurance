import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ButtonInteraction } from 'discord.js';
import { IClient } from '../../../Client.js';
import { SimpleUser } from '../../../Typings/DatabaseTypes.js';
import { MAX_TOS_VERSION, TOS_FEATURES } from '../../../TOSConstants.js';
import { ButtonHandler } from '../../../Typings/HandlerTypes.js';
import { ExpectValidResponse, HandlerResult, buttonsOf, embedOf, makeClient, makeHandler, makeInteraction, screen } from '../Helpers.js';

/**
 * `tos-accept` - the Accept button on the prompts `CheckHandlerAccess` renders. `tos-accept_<version>`
 * records that version; a bare `tos-accept` means the latest terms.
 *
 * `Services/UserTOS` and `CheckHandlerAccess` are real, over an in-memory user behind `CRUD/Users`,
 * so what is asserted is the version that ends up stored.
 */

const { GetUser, SaveUser, GetGuild } = vi.hoisted(() => ({
	GetUser : vi.fn(),
	SaveUser: vi.fn(),
	GetGuild: vi.fn()
}));
vi.mock('../../../Database.js', () => ({ Database: { query: vi.fn(() => { throw new Error('unexpected query'); }) } }));
vi.mock('../../../CRUD/Users.js', () => ({ GetUser, SaveUser }));
vi.mock('../../../CRUD/Guilds.js', async (importOriginal) => ({ ...await importOriginal<object>(), GetGuild }));

const TOSAccept = (await import('../../../Buttons/TOSAccept.js')).default;
const { CheckHandlerAccess } = await import('../../../Utils/CheckHandlerAccess.js');
const { CanUserAccessTOSFeature } = await import('../../../Services/UserTOS.js');

const USER_ID = '900000000000000005';

let user: SimpleUser;
let client: IClient;

beforeEach(async () => {
	vi.clearAllMocks();
	user = { id: BigInt(USER_ID), username: 'tester', bot: 0, terms_version_accepted: 0, wrapped_key: null, rotation_hour: 0, opt_out_collection: 0 };
	GetUser.mockImplementation(async () => user);
	SaveUser.mockImplementation(async (saved: SimpleUser) => { user = saved; });
	client = await makeClient();
});

async function accept(args: string[]): Promise<HandlerResult> {
	const result = await TOSAccept.execute(makeInteraction({ userId: USER_ID }), client, args);
	await ExpectValidResponse(result, TOSAccept);
	return result;
}

describe('tos-accept', () => {
	it.each(Array.from({ length: MAX_TOS_VERSION }, (_, i) => i + 1))('stores version %i from the custom_id', async (version) => {
		await accept([ String(version) ]);

		expect(user.terms_version_accepted).toBe(version);
		expect(SaveUser).toHaveBeenCalledOnce();
	});

	it('means the latest terms when the custom_id carries no version', async () => {
		await accept([]);
		expect(user.terms_version_accepted).toBe(MAX_TOS_VERSION);
	});

	it('thanks the user and clears the prompt\'s buttons', async () => {
		const result = await accept([ '1' ]);

		expect(embedOf(result).description).toMatch(/Thank you for accepting the terms/);
		expect(screen(result).components).toEqual([]);
	});

	it('does not look up or require a guild - accepting works in DMs and any guild', async () => {
		const interaction = { user: { id: USER_ID } } as unknown as ButtonInteraction;
		await TOSAccept.execute(interaction, {} as IClient, [ '1' ]);

		expect(user.terms_version_accepted).toBe(1);
		expect(GetGuild).not.toHaveBeenCalled();
	});

	// Bug: `tos-accept_999` stored 999, and CanUserAccessTOSFeature treats anything above MAX as having
	// accepted everything - including terms that had not been published yet
	it('refuses a version above MAX_TOS_VERSION', async () => {
		await expect(accept([ String(MAX_TOS_VERSION + 1) ])).rejects.toThrow(/Invalid TOS version/);
		await expect(accept([ '999' ])).rejects.toThrow(/Invalid TOS version/);

		expect(SaveUser).not.toHaveBeenCalled();
		expect(CanUserAccessTOSFeature(user, TOS_FEATURES.MESSAGE_EXPORTS)).toBe(false);
	});

	// Bug: `-1` was stored as-is, and `0` / garbage silently became the latest terms
	it.each([ '0', '-1', 'abc', '', '2abc', '1.5', ' 2' ])('refuses %j before touching the user', async (arg) => {
		await expect(accept([ arg ])).rejects.toThrow(/Invalid TOS version/);

		expect(GetUser).not.toHaveBeenCalled();
		expect(SaveUser).not.toHaveBeenCalled();
	});

	it('never lowers an already-accepted version (an old prompt clicked later)', async () => {
		user.terms_version_accepted = MAX_TOS_VERSION;
		const result = await accept([ '2' ]);

		expect(user.terms_version_accepted).toBe(MAX_TOS_VERSION);
		expect(SaveUser).not.toHaveBeenCalled();
		// Still answered like any accept - the old prompt's buttons go away
		expect(embedOf(result).description).toMatch(/Thank you/);
		expect(screen(result).components).toEqual([]);
	});

	it('does not rewrite the version the user already has', async () => {
		user.terms_version_accepted = 2;
		await accept([ '2' ]);

		expect(SaveUser).not.toHaveBeenCalled();
	});

	it('raises an older accepted version', async () => {
		user.terms_version_accepted = 1;
		await accept([ '3' ]);

		expect(user.terms_version_accepted).toBe(3);
	});

	it('a failed save is thrown, not thanked', async () => {
		SaveUser.mockRejectedValue(new Error('save failed'));
		await expect(accept([ '1' ])).rejects.toThrow('save failed');
	});
});

describe('tos-accept - the prompts that lead to it', () => {
	function gated(feature: number): ButtonHandler {
		return makeHandler('test', { tos_features: [ feature as ButtonHandler['tos_features'][number] ] });
	}

	/** Runs the gate and presses Accept on whatever prompt it renders */
	async function acceptPrompt(feature: number): Promise<void> {
		const prompt = await CheckHandlerAccess(makeInteraction({ userId: USER_ID, memberPerms: [] }) as never, gated(feature));
		if (!prompt) throw new Error('expected a TOS prompt');
		await ExpectValidResponse(prompt, { response_type: 'update' });

		const acceptButton = buttonsOf(prompt).find(button => 'custom_id' in button && button.custom_id.startsWith('tos-accept'));
		if (!acceptButton || !('custom_id' in acceptButton)) throw new Error('the prompt has no Accept button');
		await accept(acceptButton.custom_id.split('_').slice(1));
	}

	const FEATURES = Object.entries(TOS_FEATURES);

	it.each(FEATURES)('accepting the first-time prompt for %s unlocks it', async (_, feature) => {
		await acceptPrompt(feature);

		expect(CanUserAccessTOSFeature(user, feature)).toBe(true);
		expect(await CheckHandlerAccess(makeInteraction({ userId: USER_ID, memberPerms: [] }) as never, gated(feature))).toBeNull();
	});

	it.each(FEATURES.filter(([ , feature ]) => feature !== TOS_FEATURES.MESSAGE_EXPORTS))('accepting the updated-terms prompt for %s from v1 unlocks it', async (_, feature) => {
		user.terms_version_accepted = 1;
		await acceptPrompt(feature);

		expect(CanUserAccessTOSFeature(user, feature)).toBe(true);
		expect(user.terms_version_accepted).toBeLessThanOrEqual(MAX_TOS_VERSION);
	});

	it('the Decline button on both prompts is close', async () => {
		for (const accepted of [ 0, 1 ]) {
			user.terms_version_accepted = accepted;
			const prompt = await CheckHandlerAccess(makeInteraction({ userId: USER_ID, memberPerms: [] }) as never, gated(TOS_FEATURES.DATA_COLLECTION_OPT_OUT));
			expect(buttonsOf(prompt!).map(button => 'custom_id' in button && button.custom_id)[0]).toBe('close');
		}
	});
});
