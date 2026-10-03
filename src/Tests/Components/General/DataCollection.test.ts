import { describe, it, expect, vi, beforeEach } from 'vitest';
import { IClient } from '../../../Client.js';
import { SimpleUser } from '../../../Typings/DatabaseTypes.js';
import { ExpectValidResponse, HandlerResult, customIDs, embedOf, makeClient, makeInteraction, screen } from '../Helpers.js';

/**
 * `data-collection` - the Opt In / Opt Out buttons under `/data-collection`. Both the command and the
 * button are ungated on purpose (pinned in `Handlers/Registry.test.ts`): Discord requires that every
 * user can reach the opt-out.
 */

const { GetUser, SaveUser } = vi.hoisted(() => ({
	GetUser : vi.fn(),
	SaveUser: vi.fn()
}));
vi.mock('../../../Database.js', () => ({ Database: { query: vi.fn(() => { throw new Error('unexpected query'); }) } }));
vi.mock('../../../CRUD/Users.js', () => ({ GetUser, SaveUser }));

const DataCollection = (await import('../../../Buttons/DataCollectionPreferences.js')).default;
const DataCollectionCommand = (await import('../../../Commands/DataCollection.js')).default;

const USER_ID = '900000000000000005';

/** What `CRUD/Users` has cached - only replaced by a save that succeeds */
let cached: SimpleUser;
let client: IClient;

beforeEach(async () => {
	vi.clearAllMocks();
	cached = { id: BigInt(USER_ID), username: 'tester', bot: 0, terms_version_accepted: 0, wrapped_key: null, rotation_hour: 0, opt_out_collection: 0 };
	GetUser.mockImplementation(async () => cached);
	SaveUser.mockImplementation(async (saved: SimpleUser) => { cached = saved; });
	client = await makeClient();
});

async function choose(arg: string | undefined): Promise<HandlerResult> {
	const result = await DataCollection.execute(makeInteraction({ userId: USER_ID }), client, arg === undefined ? [] : [ arg ]);
	await ExpectValidResponse(result, DataCollection);
	return result;
}

describe('data-collection', () => {
	it('out opts the user out and says so', async () => {
		const result = await choose('out');

		expect(cached.opt_out_collection).toBe(1);
		expect(embedOf(result).description).toMatch(/\*\*opted out\*\*/);
		expect(screen(result).components).toEqual([]);
	});

	it('in opts the user back in and says so', async () => {
		cached.opt_out_collection = 1;
		const result = await choose('in');

		expect(cached.opt_out_collection).toBe(0);
		expect(embedOf(result).description).toMatch(/\*\*opted in\*\*/);
		expect(screen(result).components).toEqual([]);
	});

	it('changes nothing else on the user', async () => {
		cached.terms_version_accepted = 3;
		const before = { ...cached };
		await choose('out');

		expect(cached).toEqual({ ...before, opt_out_collection: 1 });
	});

	// Bug: anything that wasn't `out` opted the user back IN - a mangled custom_id undid an opt-out
	it.each([ undefined, '', 'OUT', 'yes', '1' ])('leaves the preference alone for %j', async (arg) => {
		cached.opt_out_collection = 1;

		await expect(choose(arg)).rejects.toThrow(/Invalid data collection choice/);
		expect(GetUser).not.toHaveBeenCalled();
		expect(SaveUser).not.toHaveBeenCalled();
		expect(cached.opt_out_collection).toBe(1);
	});

	// Bug: `void SaveUser(...)` - the user was told they had opted out while the write was still
	// pending, and a failed one was an unhandled rejection
	it('waits for the save before answering', async () => {
		let finish!: () => void;
		SaveUser.mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));

		let answered = false;
		const pending = choose('out').then(() => { answered = true; });
		await new Promise(resolve => setImmediate(resolve));
		expect(answered).toBe(false);

		finish();
		await pending;
		expect(answered).toBe(true);
	});

	it('a failed save is thrown, and the cached user is left as it was', async () => {
		SaveUser.mockRejectedValue(new Error('save failed'));

		await expect(choose('out')).rejects.toThrow('save failed');
		expect(cached.opt_out_collection).toBe(0);
	});

	it('throws for a user that cannot be resolved instead of crashing on null', async () => {
		GetUser.mockResolvedValue(null);
		await expect(choose('out')).rejects.toThrow(/User ID does not exist/);
	});
});

describe('/data-collection', () => {
	it('offers Opt Out and Opt In, routed to the button with the args it accepts', async () => {
		const result = await DataCollectionCommand.execute(makeInteraction({ userId: USER_ID }) as never, client);
		await ExpectValidResponse(result, DataCollectionCommand);

		expect(customIDs(result)).toEqual([ 'data-collection_out', 'data-collection_in' ]);

		for (const customID of customIDs(result)) {
			const arg = customID.split('_')[1];
			await choose(arg);
			expect(cached.opt_out_collection).toBe(arg === 'out' ? 1 : 0);
		}
	});
});
