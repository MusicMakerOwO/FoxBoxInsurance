import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RESTORE_OPTIONS, SNAPSHOT_TYPE } from '../../Utils/Constants.js';
import { BOT_USER_ID, makeGuild, role } from './Fixtures.js';

/**
 * §3 of the test plan: prove `BuildRestorePlan`'s diff-side mutation (`MoveBotRoleToTop` reordering
 * roles in place, see `GuildDiff.ts:54-78`) never leaks back into `GetSnapshot`'s LRU-cached
 * `Snapshot` object (`Services/RestorePlans.ts:97-103`, `DeepCopyComparable`'s reason for existing).
 *
 * Drives the real (unmocked) `GetSnapshot`/`BuildRestorePlan` code paths against a mocked
 * `Database.js` rather than a live MariaDB - the thing actually under test is the module-level LRU
 * cache in `CRUD/Snapshots.ts`, which is pure in-memory JS and does not need a real database to
 * exercise honestly. Kept out of `SnapshotRestores.test.ts` because that file's fake `Database.js`
 * models the two restore tables specifically, and would have to grow a `Snapshots` table it has no
 * other use for.
 */

vi.mock('../../Client.js', () => ({ client: { user: { id: BOT_USER_ID } } }));

const SNAPSHOT_ID = 501;
const GUILD_ID = 777n;

const snapshotRow = { id: SNAPSHOT_ID, guild_id: GUILD_ID, type: SNAPSHOT_TYPE.MANUAL, pinned: 0, created_at: new Date() };

// Deliberately not at the top of the position order - MoveBotRoleToTop has real work to do on this side.
const botRoleRow = {
	snapshot_id: SNAPSHOT_ID, deleted: 0,
	id: BigInt(BOT_USER_ID), name: 'FBI', color: 0, hoist: 0, position: 1, permissions: 8n, managed_by: BigInt(BOT_USER_ID)
};
const otherRoleRow = {
	snapshot_id: SNAPSHOT_ID, deleted: 0,
	id: 2n, name: 'Mod', color: 0, hoist: 0, position: 5, permissions: 0n, managed_by: null
};

const { query, getConnection, releaseConnection } = vi.hoisted(() => ({
	query: vi.fn(),
	getConnection: vi.fn(),
	releaseConnection: vi.fn()
}));
vi.mock('../../Database.js', () => ({ Database: { query, getConnection, releaseConnection } }));

function connectionQuery(sql: string) {
	if (sql.includes('FROM SnapshotRoles')) return Promise.resolve([botRoleRow, otherRoleRow]);
	if (sql.includes('FROM SnapshotChannels')) return Promise.resolve([]);
	if (sql.includes('FROM SnapshotBans')) return Promise.resolve([]);
	if (sql.includes('FROM Snapshots')) return Promise.resolve([snapshotRow]);
	throw new Error(`unexpected connection query: ${sql}`);
}

beforeEach(() => {
	query.mockReset();
	query.mockImplementation(async (sql: string, params: unknown[] = []) => {
		if (sql.includes('FROM Snapshots') && sql.includes('WHERE id = ?')) {
			return params[0] === SNAPSHOT_ID ? [snapshotRow] : [];
		}
		if (sql.includes('FROM Snapshots') && sql.includes('WHERE guild_id = ?')) {
			return params[0] === GUILD_ID ? [{ id: SNAPSHOT_ID }] : [];
		}
		throw new Error(`unexpected query: ${sql}`);
	});
	getConnection.mockReset();
	getConnection.mockResolvedValue({ query: connectionQuery });
	releaseConnection.mockReset();
});

const { GetSnapshot } = await import('../../CRUD/Snapshots.js');
const { BuildRestorePlan } = await import('../../Services/RestorePlans.js');

describe('GetSnapshot LRU cache - not poisoned by BuildRestorePlan', () => {
	it('role positions read back unchanged, off the same cached object, after building a plan that reorders the bot role', async () => {
		const snapshot = await GetSnapshot(SNAPSHOT_ID);
		expect(snapshot).not.toBeNull();
		expect(getConnection).toHaveBeenCalledTimes(1); // sanity: the first read really did hit "the database"

		const before = new Map(Array.from(snapshot!.roles.values()).map(r => [r.id, r.position]));
		expect(before.get(BigInt(BOT_USER_ID))).toBe(1); // not at the top yet

		const guild = makeGuild(
			[
				role(BigInt(BOT_USER_ID), 'FBI', { managed_by: BigInt(BOT_USER_ID), position: 50 }),
				role(2n, 'Mod', { position: 10 })
			],
			[],
			{ id: GUILD_ID.toString() }
		);

		await BuildRestorePlan(guild, snapshot!, RESTORE_OPTIONS.ROLES);

		const rehydrated = await GetSnapshot(SNAPSHOT_ID);
		expect(rehydrated).toBe(snapshot); // still a cache hit - no new query fired
		expect(getConnection).toHaveBeenCalledTimes(1);

		const after = new Map(Array.from(rehydrated!.roles.values()).map(r => [r.id, r.position]));
		expect(after).toEqual(before);
		expect(after.get(BigInt(BOT_USER_ID))).toBe(1); // still not moved - the mutation stayed on BuildRestorePlan's own copy
	});
});
