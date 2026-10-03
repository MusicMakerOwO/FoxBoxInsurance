import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { IClient } from '../../../Client.js';
import { SNAPSHOT_TYPE } from '../../../Utils/Constants.js';
import { JSONSnapshot } from '../../../CRUD/Snapshots.js';
import { MAX_TOS_VERSION } from '../../../TOSConstants.js';
import { GUILD_FEATURES } from '../../../Typings/DatabaseTypes.js';
import { DiscordPermissions } from '../../../Utils/DiscordConstants.js';
import { ButtonHandler, CommandHandler } from '../../../Typings/HandlerTypes.js';
import { ExpectValidResponse, HandlerResult, customIDs, embedOf, makeClient, selectsOf } from '../Helpers.js';
import { GUILD_ID, OTHER_GUILD_ID, ResetStore, interaction } from '../Snapshots/Fixtures.js';

/**
 * Staging: `/snapshot import` holds the upload behind the "can contain harmful data" warning, and only
 * `import-confirm` puts it in the guild's list - the list being what snapshot-list shows and every
 * restore screen resolves through GetGuildSnapshot. `import-cancel` throws the staged upload away.
 *
 * Runs against the real CRUD/SnapshotImports (it's all in memory). Its state is module-global, so
 * every test uses its own import ids.
 */

vi.mock('../../../Database.js', () => ({ Database: { query: vi.fn() } }));
vi.mock('../../../CRUD/Snapshots.js', async (importOriginal) => ({ ...await importOriginal<object>(), ...(await import('../Snapshots/Fixtures.js')).SnapshotsMock }));

const { clientRef, GetUser, GetGuild, BuildSnapshotFromImport } = vi.hoisted(() => ({
	clientRef: {} as Record<string, unknown>,
	GetUser  : vi.fn(),
	GetGuild : vi.fn(),
	BuildSnapshotFromImport: vi.fn()
}));
vi.mock('../../../Client.js', () => ({ client: clientRef }));
vi.mock('../../../CRUD/Users.js', () => ({ GetUser }));
vi.mock('../../../CRUD/Guilds.js', () => ({ GetGuild }));
vi.mock('../../../Utils/Snapshots/Imports/Parse.js', () => ({ BuildSnapshotFromImport }));
vi.mock('../../../Services/RestoreRunner.js', () => ({ IsRestoreRunning: () => false }));

const Imports = await import('../../../CRUD/SnapshotImports.js');
const { GetGuildSnapshot } = await import('../../../Services/SnapshotLookup.js');
const SnapshotCommand = (await import('../../../Commands/Snapshot.js')).default as CommandHandler;
const SnapshotList = (await import('../../../Buttons/Snapshots/List.js')).default;
const ImportConfirm = (await import('../../../Buttons/Imports/Confirm.js')).default;
const ButtonEvents = (await import('../../../Events/Handlers/Buttons.js')).default;

const HOUR = 60 * 60 * 1000;
const ADMIN = DiscordPermissions.Administrator;

let client: IClient;
let nextID = 0;

/** A fresh import id per call - the module's state outlives each test */
function NewImport(channels = 0): JSONSnapshot {
	nextID++;
	return {
		id      : `AAAA-BBBB-CCCC-${String(nextID).padStart(4, 'D')}`,
		version : 2,
		type    : SNAPSHOT_TYPE.IMPORT,
		channels: Array.from({ length: channels }, (_, i) => ({ id: BigInt(i + 1), name: `channel-${i}` })),
		roles   : [],
		bans    : []
	} as unknown as JSONSnapshot;
}

beforeEach(async () => {
	vi.clearAllMocks();
	vi.useFakeTimers({ toFake: [ 'Date' ] });
	vi.setSystemTime(new Date('2026-10-02T12:00:00Z'));
	ResetStore();
	GetUser.mockResolvedValue({ terms_version_accepted: MAX_TOS_VERSION });
	GetGuild.mockResolvedValue({ id: BigInt(GUILD_ID), features: GUILD_FEATURES.IMPORT_SNAPSHOTS | GUILD_FEATURES.MANAGE_SNAPSHOTS });
	client = Object.assign(clientRef, await makeClient(), { user: { id: '900000000000000001' } }) as unknown as IClient;
});

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

describe('CRUD/SnapshotImports', () => {
	it('a staged import is only visible through GetStagedImport', () => {
		const data = NewImport();
		Imports.StageImportForGuild(GUILD_ID, data);

		expect(Imports.GetStagedImport(GUILD_ID, data.id)).toMatchObject({ id: data.id, expires_at: Date.now() + HOUR });
		expect(Imports.GetImportsForGuild(GUILD_ID).has(data.id)).toBe(false);
		expect(Imports.GetStagedImport(OTHER_GUILD_ID, data.id)).toBeNull();
	});

	it('a staged import expires after IMPORT_EXPIRATION', () => {
		const data = NewImport();
		Imports.StageImportForGuild(GUILD_ID, data);

		vi.setSystemTime(Date.now() + Imports.IMPORT_EXPIRATION + 1);
		expect(Imports.GetStagedImport(GUILD_ID, data.id)).toBeNull();
	});

	it('DiscardStagedImport drops the staged copy only', () => {
		const data = NewImport();
		Imports.SaveImportForGuild(GUILD_ID, data);
		Imports.StageImportForGuild(GUILD_ID, data);

		Imports.DiscardStagedImport(GUILD_ID, data.id);
		expect(Imports.GetStagedImport(GUILD_ID, data.id)).toBeNull();
		expect(Imports.GetImportsForGuild(GUILD_ID).has(data.id)).toBe(true);
	});

	it('SaveImportForGuild lists for a fresh hour from confirm, drops the staged copy, and returns the expiry', () => {
		const data = NewImport();
		Imports.StageImportForGuild(GUILD_ID, data);
		vi.setSystemTime(Date.now() + 50 * 60 * 1000);

		const expiresAt = Imports.SaveImportForGuild(GUILD_ID, Imports.GetStagedImport(GUILD_ID, data.id)!);

		expect(expiresAt).toBe(Date.now() + HOUR);
		expect(Imports.GetImportsForGuild(GUILD_ID).get(data.id)?.expires_at).toBe(expiresAt);
		expect(Imports.GetStagedImport(GUILD_ID, data.id)).toBeNull();
	});

	it('listing an already-listed import restarts its clock', () => {
		const data = NewImport();
		const first = Imports.SaveImportForGuild(GUILD_ID, data);
		vi.setSystemTime(Date.now() + 30 * 60 * 1000);

		const second = Imports.SaveImportForGuild(GUILD_ID, Imports.GetImportsForGuild(GUILD_ID).get(data.id)!);
		expect(second).toBe(first + 30 * 60 * 1000);
		expect(Imports.GetImportsForGuild(GUILD_ID).get(data.id)?.expires_at).toBe(second);
	});

	it("one guild's listing expiring doesn't free data another guild still has staged", () => {
		const data = NewImport(2);
		Imports.SaveImportForGuild(OTHER_GUILD_ID, data);
		vi.setSystemTime(Date.now() + 50 * 60 * 1000);
		Imports.StageImportForGuild(GUILD_ID, data);

		vi.setSystemTime(Date.now() + 11 * 60 * 1000);
		expect(Imports.GetImportsForGuild(OTHER_GUILD_ID).has(data.id)).toBe(false); // pruned
		expect(Imports.GetStagedImport(GUILD_ID, data.id)?.channels).toHaveLength(2);
	});

	it('a re-upload replaces the cached data', () => {
		const data = NewImport(1);
		Imports.StageImportForGuild(GUILD_ID, data);
		Imports.StageImportForGuild(GUILD_ID, { ...data, channels: [ ...data.channels, ...data.channels ] });

		expect(Imports.GetStagedImport(GUILD_ID, data.id)?.channels).toHaveLength(2);
	});
});

//////////////////
// The flow
//////////////////

/** `/snapshot import` with an uploaded file that parses to `data` */
async function upload(data: JSONSnapshot): Promise<HandlerResult> {
	vi.stubGlobal('fetch', vi.fn(async () => ({ text: async () => JSON.stringify({ id: data.id, version: 2 }) })));
	BuildSnapshotFromImport.mockResolvedValue(data);

	const sent = Object.assign(interaction({ memberPerms: [ ADMIN ] }), {
		options: {
			getSubcommand: () => 'import',
			getAttachment: () => ({ name: 'snapshot.json', url: 'https://cdn.example/snapshot.json' })
		}
	});
	// The command insists on a bot role before any subcommand
	(sent.guild as unknown as Record<string, unknown>).roles = { cache: { find: () => ({ id: 'bot-role' }) } };

	const result = await SnapshotCommand.execute(sent as never, client);
	await ExpectValidResponse(result, { response_type: 'update' });
	return result;
}

async function run(handler: ButtonHandler, ...args: string[]): Promise<HandlerResult> {
	const result = await handler.execute(interaction(), client, args);
	await ExpectValidResponse(result, handler);
	return result;
}

/** What snapshot-list offers in its select, or [] on the No Snapshots screen */
async function listed(): Promise<string[]> {
	const result = await run(SnapshotList);
	return selectsOf(result)[0]?.options.map(option => option.value) ?? [];
}

async function dispatch(customId: string) {
	const sent = interaction({ customId, memberPerms: [ ADMIN ] });
	await ButtonEvents.execute(sent);
	return sent;
}

describe('/snapshot import -> import-confirm', () => {
	it('uploading stages the import behind the warning without listing it', async () => {
		const data = NewImport();
		const result = await upload(data);

		expect(embedOf(result).title).toBe('Import Snapshot?');
		expect(customIDs(result)).toContain(`import-confirm_${data.id}`);

		expect(Imports.GetStagedImport(GUILD_ID, data.id)).not.toBeNull();
		expect(Imports.GetImportsForGuild(GUILD_ID).has(data.id)).toBe(false);
		expect(await listed()).not.toContain(data.id);
		// Every restore screen resolves through this, so restore-options refuses it too
		expect(await GetGuildSnapshot(GUILD_ID, data.id)).toBeNull();
	});

	it('import-confirm is what lists it', async () => {
		const data = NewImport();
		await upload(data);
		await run(ImportConfirm, data.id);

		expect(Imports.GetStagedImport(GUILD_ID, data.id)).toBeNull();
		expect(await listed()).toContain(data.id);
		expect(await GetGuildSnapshot(GUILD_ID, data.id)).toMatchObject({ id: data.id });
	});
});

describe('import-cancel', () => {
	it('[dispatcher] discards the staged import and deletes the prompt, editing nothing', async () => {
		const data = NewImport();
		await upload(data);

		const sent = await dispatch(`import-cancel_${data.id}`);

		expect(sent.deleteReply).toHaveBeenCalledOnce();
		expect(sent.editReply).not.toHaveBeenCalled();
		expect(sent.reply).not.toHaveBeenCalled();
		expect(Imports.GetStagedImport(GUILD_ID, data.id)).toBeNull();
		expect(await listed()).not.toContain(data.id);
	});

	it('leaves an already-listed import listed', async () => {
		const data = NewImport();
		Imports.SaveImportForGuild(GUILD_ID, data);

		await dispatch(`import-cancel_${data.id}`);
		expect(await listed()).toContain(data.id);
	});
});
