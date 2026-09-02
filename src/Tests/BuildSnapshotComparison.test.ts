import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ChannelType, Guild, PermissionsBitField } from 'discord.js';
import { Snapshot, JSONSnapshot } from '../CRUD/Snapshots.js';
import { ban, channel, makeJSONSnapshot, makeSnapshot, overwrite, role } from './Restore/Fixtures.js';

// The live-`Guild` branch is gated on `data instanceof Guild`, so the ban fetch can only be reached
// with a real prototype - and the real fetch would hit the network. Mocked here so the branch is
// observable (call count, awaited-ness, rejection) without one.
const { FetchAllBansSpy } = vi.hoisted(() => ({ FetchAllBansSpy: vi.fn() }));
vi.mock('../Utils/Snapshots/FetchAllBans.js', () => ({ FetchAllBans: FetchAllBansSpy }));

const { BuildSnapshotComparison } = await import('../Utils/Snapshots/BuildSnapshotComparison.js');

beforeEach(() => {
	FetchAllBansSpy.mockReset();
	FetchAllBansSpy.mockResolvedValue(new Map());
});

const MOD     = role(2n, 'Mod', { color: 0xFF0000, position: 5, hoist: 1, permissions: 8n });
const GENERAL = channel(10n, 'general', ChannelType.GuildText, 20n, { topic: 'chat', nsfw: 1, position: 3 });
const NEWS    = channel(20n, 'news', ChannelType.GuildCategory, null);

/**
 * A `Guild` only as far as `BuildSnapshotComparison` reads it, but built on the real prototype so
 * the `instanceof Guild` ban branch is taken. `makeGuild` in the restore fixtures deliberately is
 * *not* a real instance (its consumers read `data.bans` directly), so it can't be reused here.
 */
function makeRealGuild(roles: { id: string }[], channels: { id: string }[]): Guild {
	const guild = Object.create(Guild.prototype) as Guild;

	Object.assign(guild, {
		id      : '1',
		roles   : { cache: new Map(roles   .map(r => [r.id, r])) },
		channels: { cache: new Map(channels.map(c => [c.id, c])) }
	});

	return guild;
}

/** A `Role` as `SimplifyRole` reads it: string id, a `tags.botId` rather than `managed_by`, a bitfield */
function liveRole(id: string, name: string, options: { botID?: string, position?: number } = {}) {
	return {
		id, name,
		color      : 0,
		position   : options.position ?? 1,
		hoist      : false,
		permissions: new PermissionsBitField(8n),
		tags       : options.botID ? { botId: options.botID } : undefined
	};
}

/** A `GuildBasedChannel` as `SimplifyChannel` reads it - note `guild` is what selects the overwrite branch */
function liveChannel(id: string, name: string, type: ChannelType, parentID: string | null, overwrites: [string, ReturnType<typeof overwrite>][] = []) {
	return {
		id, name, type,
		guild   : { id: '1' },
		position: 0,
		topic   : null,
		nsfw    : false,
		parentId: parentID,
		permissionOverwrites: {
			cache: new Map(overwrites.map(([targetID, o]) => [targetID, {
				id   : targetID,
				allow: new PermissionsBitField(BigInt(o.allow)),
				deny : new PermissionsBitField(BigInt(o.deny)),
				type : o.type
			}]))
		}
	};
}

describe('BuildSnapshotComparison - null input', () => {
	it('returns three empty maps rather than throwing', async () => {
		const comparison = await BuildSnapshotComparison(null);

		expect(comparison.roles.size).toBe(0);
		expect(comparison.channels.size).toBe(0);
		expect(comparison.bans.size).toBe(0);
		expect(FetchAllBansSpy).not.toHaveBeenCalled();
	});
});

describe('BuildSnapshotComparison - stored Snapshot (Map-backed)', () => {
	it('keys every collection on bigint IDs', async () => {
		const snapshot = makeSnapshot(1, [MOD], [NEWS, GENERAL], [ban(70n, 'raid')]);
		const comparison = await BuildSnapshotComparison(snapshot);

		expect([...comparison.roles.keys()   ]).toEqual([2n]);
		expect([...comparison.channels.keys()]).toEqual([20n, 10n]);
		expect([...comparison.bans.keys()    ]).toEqual([70n]);
	});

	it('preserves every simplified field verbatim', async () => {
		const snapshot = makeSnapshot(1, [MOD], [GENERAL], [ban(70n, 'raid')]);
		const comparison = await BuildSnapshotComparison(snapshot);

		expect(comparison.roles.get(2n)).toEqual({
			id: 2n, name: 'Mod', color: 0xFF0000, position: 5, hoist: 1, managed_by: null, permissions: 8n
		});
		expect(comparison.channels.get(10n)).toEqual({
			id: 10n, name: 'general', type: ChannelType.GuildText, position: 3, topic: 'chat',
			nsfw: 1, parent_id: 20n, permission_overwrites: {}
		});
		expect(comparison.bans.get(70n)).toEqual({ id: 70n, reason: 'raid' });
	});

	it('never fetches bans for a stored snapshot', async () => {
		await BuildSnapshotComparison(makeSnapshot(1, [MOD], []));
		expect(FetchAllBansSpy).not.toHaveBeenCalled();
	});

	it('handles a snapshot whose collections are all empty', async () => {
		const comparison = await BuildSnapshotComparison(makeSnapshot(1, [], []));

		expect(comparison.roles.size).toBe(0);
		expect(comparison.channels.size).toBe(0);
		expect(comparison.bans.size).toBe(0);
	});
});

describe('BuildSnapshotComparison - JSONSnapshot (array-backed imports)', () => {
	it('produces the same shape as the stored-Snapshot path', async () => {
		const roles = [MOD], channels = [NEWS, GENERAL], bans = [ban(70n, 'raid')];

		const fromImport = await BuildSnapshotComparison(makeJSONSnapshot('ABCD', roles, channels, bans));
		const fromStored = await BuildSnapshotComparison(makeSnapshot(1, roles, channels, bans));

		expect(fromImport).toEqual(fromStored);
	});

	it('keys arrays on bigint IDs, not array indices', async () => {
		const comparison = await BuildSnapshotComparison(makeJSONSnapshot('ABCD', [MOD], [GENERAL], [ban(70n)]));

		expect(comparison.roles.get(2n)?.name).toBe('Mod');
		expect(comparison.channels.get(10n)?.name).toBe('general');
		expect(comparison.bans.get(70n)?.reason).toBe('No reason provided');
		expect(comparison.roles.has(0n)).toBe(false);
	});

	it('keeps an import role\'s managed_by, including the v1 `1n` sentinel', async () => {
		// v1 exports don't record which bot owns a managed role, so they store `1n`. `MoveBotRoleToTop`
		// matches on it - dropping it here would make every v1 import fail to find a bot role.
		const comparison = await BuildSnapshotComparison(makeJSONSnapshot('ABCD', [
			role(3n, 'Bot v1', { managed_by: 1n }),
			role(4n, 'Bot v2', { managed_by: 999n })
		], []));

		expect(comparison.roles.get(3n)?.managed_by).toBe(1n);
		expect(comparison.roles.get(4n)?.managed_by).toBe(999n);
	});

	it('accepts empty arrays without throwing', async () => {
		const comparison = await BuildSnapshotComparison(makeJSONSnapshot('ABCD', [], [], []));

		expect(comparison.roles.size).toBe(0);
		expect(comparison.channels.size).toBe(0);
		expect(comparison.bans.size).toBe(0);
	});

	it('preserves channel permission overwrites as-is', async () => {
		const withOverwrites = channel(10n, 'general', ChannelType.GuildText, null, {
			permission_overwrites: { '2': overwrite('8', '16', 0) }
		});
		const comparison = await BuildSnapshotComparison(makeJSONSnapshot('ABCD', [], [withOverwrites]));

		expect(comparison.channels.get(10n)?.permission_overwrites).toEqual({ '2': { allow: '8', deny: '16', type: 0 } });
	});
});

describe('BuildSnapshotComparison - live Guild', () => {
	it('reads through `.cache` and awaits FetchAllBans', async () => {
		FetchAllBansSpy.mockResolvedValue(new Map([
			['70', { user: { id: '70' }, reason: 'raid' }]
		]));

		const guild = makeRealGuild(
			[liveRole('2', 'Mod')],
			[liveChannel('20', 'news', ChannelType.GuildCategory, null), liveChannel('10', 'general', ChannelType.GuildText, '20')]
		);
		const comparison = await BuildSnapshotComparison(guild);

		expect(FetchAllBansSpy).toHaveBeenCalledTimes(1);
		expect(FetchAllBansSpy).toHaveBeenCalledWith(guild);

		expect(comparison.roles.get(2n)?.name).toBe('Mod');
		expect(comparison.channels.get(10n)?.parent_id).toBe(20n);
		expect(comparison.channels.get(20n)?.type).toBe(ChannelType.GuildCategory);
		// Awaited, not left as a pending promise the ban map would have been built from
		expect(comparison.bans.get(70n)).toEqual({ id: 70n, reason: 'raid' });
	});

	it('derives managed_by from `tags.botId` and normalises the permission bitfield', async () => {
		const guild = makeRealGuild([liveRole('2', 'Mod'), liveRole('999', 'FBI', { botID: '999' })], []);
		const comparison = await BuildSnapshotComparison(guild);

		expect(comparison.roles.get(2n)  ?.managed_by).toBe(null);
		expect(comparison.roles.get(999n)?.managed_by).toBe(999n);
		expect(comparison.roles.get(2n)  ?.permissions).toBe(8n);
	});

	it('serialises live permission overwrites into the stored string shape', async () => {
		const guild = makeRealGuild([], [
			liveChannel('10', 'general', ChannelType.GuildText, null, [['2', overwrite('8', '16', 0)]])
		]);
		const comparison = await BuildSnapshotComparison(guild);

		expect(comparison.channels.get(10n)?.permission_overwrites).toEqual({ '2': { allow: '8', deny: '16', type: 0 } });
	});

	it('swallows a FetchAllBans rejection and yields an empty ban map', async () => {
		// A guild without Ban Members should still diff roles and channels rather than failing the
		// whole comparison
		FetchAllBansSpy.mockRejectedValue(new Error('Missing Permissions'));

		const guild = makeRealGuild([liveRole('2', 'Mod')], []);
		const comparison = await BuildSnapshotComparison(guild);

		expect(comparison.bans.size).toBe(0);
		expect(comparison.roles.get(2n)?.name).toBe('Mod');
	});

	it('keys a live GuildBan on the user snowflake, a stored ban on its own id', async () => {
		// The two ban shapes are the only place the key is derived differently; both must land on
		// the banned user's snowflake or a live ban would never pair with its snapshot counterpart
		FetchAllBansSpy.mockResolvedValue(new Map([['70', { user: { id: '70' }, reason: 'raid' }]]));

		const live   = await BuildSnapshotComparison(makeRealGuild([], []));
		const stored = await BuildSnapshotComparison(makeSnapshot(1, [], [], [ban(70n, 'raid')]));

		expect([...live.bans.keys()]).toEqual([...stored.bans.keys()]);
		expect(live.bans.get(70n)).toEqual(stored.bans.get(70n));
	});

	it('defaults a live ban with no reason to the stored placeholder', async () => {
		FetchAllBansSpy.mockResolvedValue(new Map([['70', { user: { id: '70' }, reason: null }]]));

		const comparison = await BuildSnapshotComparison(makeRealGuild([], []));

		expect(comparison.bans.get(70n)?.reason).toBe('No reason provided');
	});
});

describe('BuildSnapshotComparison - input is not mutated', () => {
	it('leaves a stored Snapshot untouched', async () => {
		const snapshot: Snapshot = makeSnapshot(1, [MOD], [GENERAL], [ban(70n)]);
		const before = { roles: snapshot.roles.get(2n), channels: snapshot.channels.get(10n) };

		await BuildSnapshotComparison(snapshot);

		expect(snapshot.roles.get(2n)).toBe(before.roles);
		expect(snapshot.channels.get(10n)).toBe(before.channels);
		expect(snapshot.roles.get(2n)).toMatchObject({ position: 5, permissions: 8n });
	});

	it('leaves a JSONSnapshot\'s arrays untouched', async () => {
		const snapshot: JSONSnapshot = makeJSONSnapshot('ABCD', [MOD], [GENERAL], [ban(70n)]);

		await BuildSnapshotComparison(snapshot);

		expect(snapshot.roles).toHaveLength(1);
		expect(snapshot.roles[0]).toMatchObject({ id: 2n, position: 5 });
	});
});
