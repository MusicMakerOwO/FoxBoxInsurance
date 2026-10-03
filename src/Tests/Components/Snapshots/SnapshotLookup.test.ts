import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GUILD_ID, IMPORT_ID, OTHER_GUILD_ID, ResetStore, SnapshotsMock, importSnapshot, storedSnapshot } from './Fixtures.js';

/**
 * `GetGuildSnapshot` - the one lookup every snapshot and restore handler resolves an id through.
 * Stored snapshots are keyed by id alone, so the guild check lives here; and an import id must never
 * be read as a stored id, since `parseInt('2345-ABCD-...')` is 2345.
 */

vi.mock('../../../Database.js', () => ({ Database: { query: vi.fn() } }));
vi.mock('../../../CRUD/Snapshots.js', async (importOriginal) => ({ ...await importOriginal<object>(), ...(await import('./Fixtures.js')).SnapshotsMock }));
vi.mock('../../../CRUD/SnapshotImports.js', async () => (await import('./Fixtures.js')).ImportsMock);

const { GetGuildSnapshot, ParseStoredSnapshotID } = await import('../../../Services/SnapshotLookup.js');

beforeEach(() => {
	vi.clearAllMocks();
	ResetStore();
});

describe('GetGuildSnapshot', () => {
	it("returns this guild's import by its id", async () => {
		const data = importSnapshot();
		expect(await GetGuildSnapshot(GUILD_ID, IMPORT_ID)).toMatchObject({ id: data.id, expires_at: data.expires_at });
	});

	it("returns this guild's stored snapshot by its id", async () => {
		const snapshot = storedSnapshot(5);
		expect(await GetGuildSnapshot(GUILD_ID, '5')).toBe(snapshot);
	});

	it("refuses another guild's stored snapshot", async () => {
		storedSnapshot(5, { guild_id: BigInt(OTHER_GUILD_ID) });
		expect(await GetGuildSnapshot(GUILD_ID, '5')).toBeNull();
	});

	it("refuses another guild's import", async () => {
		importSnapshot(IMPORT_ID, { guildID: OTHER_GUILD_ID });
		expect(await GetGuildSnapshot(GUILD_ID, IMPORT_ID)).toBeNull();
	});

	it('an expired import id never falls through to a stored snapshot', async () => {
		importSnapshot(IMPORT_ID, { expires_at: Date.now() - 1 });
		storedSnapshot(2345);

		expect(await GetGuildSnapshot(GUILD_ID, IMPORT_ID)).toBeNull();
		expect(SnapshotsMock.GetSnapshot).not.toHaveBeenCalled();
	});

	it('an unknown stored id is null', async () => {
		expect(await GetGuildSnapshot(GUILD_ID, '5')).toBeNull();
	});

	it.each([ '05', '5abc', '0', '-5', '5.0', ' 5', '', '99999999999999999999' ])('non-canonical id %j is never looked up as stored', async (id) => {
		storedSnapshot(5);
		expect(await GetGuildSnapshot(GUILD_ID, id)).toBeNull();
		expect(SnapshotsMock.GetSnapshot).not.toHaveBeenCalled();
	});
});

describe('ParseStoredSnapshotID', () => {
	it.each([ [ '1', 1 ], [ '42', 42 ], [ '2345', 2345 ] ])('%j -> %d', (id, expected) => {
		expect(ParseStoredSnapshotID(id)).toBe(expected);
	});

	it.each([ undefined, '', '0', '05', '-1', 'abc', IMPORT_ID, '1e3', '99999999999999999999' ])('%j -> null', (id) => {
		expect(ParseStoredSnapshotID(id)).toBeNull();
	});
});
