import { describe, it, expect, beforeAll } from 'vitest';
import { ChannelType } from 'discord.js';
import { CreateSnapshotDiff, ComparableEntry, SnapshotComparable } from '../Utils/Snapshots/GuildDiff.js';
import { SnapshotRole, SnapshotChannel, SnapshotBan } from '../Typings/DatabaseTypes.js';
import { DIFF_CHANGE_TYPE } from '../Utils/Constants.js';
import { client } from '../Client.js';

const BOT_ID = 900000000000000001n;

function makeRole(overrides: Partial<ComparableEntry<SnapshotRole>> = {}): ComparableEntry<SnapshotRole> {
	return {
		id: 1n,
		name: 'Role',
		color: 0,
		hoist: 0,
		position: 1,
		permissions: 0n,
		managed_by: null,
		...overrides
	};
}

// Positioned above every other role in these fixtures so MoveBotRoleToTop never needs to mutate it.
function makeBotRole(overrides: Partial<ComparableEntry<SnapshotRole>> = {}): ComparableEntry<SnapshotRole> {
	return makeRole({ id: BOT_ID, name: 'Bot', position: 100, managed_by: BOT_ID, ...overrides });
}

function makeChannel(overrides: Partial<ComparableEntry<SnapshotChannel>> = {}): ComparableEntry<SnapshotChannel> {
	return {
		id: 10n,
		type: ChannelType.GuildText,
		name: 'general',
		position: 0,
		topic: null,
		nsfw: 0,
		parent_id: null,
		permission_overwrites: {},
		...overrides
	};
}

function makeBan(overrides: Partial<ComparableEntry<SnapshotBan>> = {}): ComparableEntry<SnapshotBan> {
	return { id: 30n, reason: 'No reason provided', ...overrides };
}

function emptySnapshot(): SnapshotComparable {
	return { roles: new Map(), channels: new Map(), bans: new Map() };
}

beforeAll(() => {
	client.user = { id: BOT_ID.toString() } as unknown as typeof client.user;
});

describe('CreateSnapshotDiff', () => {
	describe('Roles', () => {
		it('errors if there is no bot role and there is at least 1 role', () => {
			const base: SnapshotComparable = {
				...emptySnapshot(),
				roles: new Map([[1n, makeRole({ id: 1n, managed_by: null })]])
			};
			const target = emptySnapshot();

			expect(() => CreateSnapshotDiff(base, target))
				.toThrow('Could not find a bot role in the provided guild - Was the bot given no permissions upon invite?');
		});

		it('does not error if roles are empty', () => {
			const base = emptySnapshot();
			const target = emptySnapshot();

			expect(() => CreateSnapshotDiff(base, target)).not.toThrow();
		});

		it('returns created roles', () => {
			const base: SnapshotComparable = { ...emptySnapshot(), roles: new Map([[BOT_ID, makeBotRole()]]) };
			const newRole = makeRole({ id: 2n, name: 'New Role' });
			const target: SnapshotComparable = {
				...emptySnapshot(),
				roles: new Map([[BOT_ID, makeBotRole()], [2n, newRole]])
			};

			const diff = CreateSnapshotDiff(base, target);

			expect(diff.roles.size).toBe(1);
			expect(diff.roles.get(2n)).toEqual({ change_type: DIFF_CHANGE_TYPE.CREATE, ...newRole });
		});

		it('returns deleted roles', () => {
			const oldRole = makeRole({ id: 2n, name: 'Old Role' });
			const base: SnapshotComparable = {
				...emptySnapshot(),
				roles: new Map([[BOT_ID, makeBotRole()], [2n, oldRole]])
			};
			const target: SnapshotComparable = { ...emptySnapshot(), roles: new Map([[BOT_ID, makeBotRole()]]) };

			const diff = CreateSnapshotDiff(base, target);

			expect(diff.roles.size).toBe(1);
			expect(diff.roles.get(2n)).toEqual({ change_type: DIFF_CHANGE_TYPE.DELETE, ...oldRole });
		});

		it('returns updated roles', () => {
			const base: SnapshotComparable = {
				...emptySnapshot(),
				roles: new Map([[BOT_ID, makeBotRole()], [2n, makeRole({ id: 2n, name: 'Old Name' })]])
			};
			const updatedRole = makeRole({ id: 2n, name: 'New Name' });
			const target: SnapshotComparable = {
				...emptySnapshot(),
				roles: new Map([[BOT_ID, makeBotRole()], [2n, updatedRole]])
			};

			const diff = CreateSnapshotDiff(base, target);

			expect(diff.roles.size).toBe(1);
			expect(diff.roles.get(2n)).toEqual({ change_type: DIFF_CHANGE_TYPE.UPDATE, ...updatedRole });
		});
	});

	describe('Channels', () => {
		it('returns created channel', () => {
			const base = emptySnapshot();
			const newChannel = makeChannel();
			const target: SnapshotComparable = { ...emptySnapshot(), channels: new Map([[10n, newChannel]]) };

			const diff = CreateSnapshotDiff(base, target);

			expect(diff.channels.size).toBe(1);
			expect(diff.channels.get(10n)).toEqual({ change_type: DIFF_CHANGE_TYPE.CREATE, ...newChannel });
		});

		it('returns deleted channels', () => {
			const oldChannel = makeChannel();
			const base: SnapshotComparable = { ...emptySnapshot(), channels: new Map([[10n, oldChannel]]) };
			const target = emptySnapshot();

			const diff = CreateSnapshotDiff(base, target);

			expect(diff.channels.size).toBe(1);
			expect(diff.channels.get(10n)).toEqual({ change_type: DIFF_CHANGE_TYPE.DELETE, ...oldChannel });
		});

		it('returns updated channels', () => {
			const base: SnapshotComparable = {
				...emptySnapshot(),
				channels: new Map([[10n, makeChannel({ name: 'general' })]])
			};
			const updatedChannel = makeChannel({ name: 'general-renamed' });
			const target: SnapshotComparable = { ...emptySnapshot(), channels: new Map([[10n, updatedChannel]]) };

			const diff = CreateSnapshotDiff(base, target);

			expect(diff.channels.size).toBe(1);
			expect(diff.channels.get(10n)).toEqual({ change_type: DIFF_CHANGE_TYPE.UPDATE, ...updatedChannel });
		});
	});

	describe('Permissions', () => {
		it('returns updated channel with added permission', () => {
			const base: SnapshotComparable = {
				...emptySnapshot(),
				channels: new Map([[10n, makeChannel({ permission_overwrites: {} })]])
			};
			const updatedChannel = makeChannel({ permission_overwrites: { '500': { allow: '8', deny: '0', type: 0 } } });
			const target: SnapshotComparable = { ...emptySnapshot(), channels: new Map([[10n, updatedChannel]]) };

			const diff = CreateSnapshotDiff(base, target);

			expect(diff.channels.get(10n)).toEqual({ change_type: DIFF_CHANGE_TYPE.UPDATE, ...updatedChannel });
		});

		it('returns updated channel with removed permission', () => {
			const base: SnapshotComparable = {
				...emptySnapshot(),
				channels: new Map([[10n, makeChannel({ permission_overwrites: { '500': { allow: '8', deny: '0', type: 0 } } })]])
			};
			const updatedChannel = makeChannel({ permission_overwrites: {} });
			const target: SnapshotComparable = { ...emptySnapshot(), channels: new Map([[10n, updatedChannel]]) };

			const diff = CreateSnapshotDiff(base, target);

			expect(diff.channels.get(10n)).toEqual({ change_type: DIFF_CHANGE_TYPE.UPDATE, ...updatedChannel });
		});

		it('returns updated channel with modified permission', () => {
			const base: SnapshotComparable = {
				...emptySnapshot(),
				channels: new Map([[10n, makeChannel({ permission_overwrites: { '500': { allow: '8', deny: '0', type: 0 } } })]])
			};
			const updatedChannel = makeChannel({ permission_overwrites: { '500': { allow: '16', deny: '0', type: 0 } } });
			const target: SnapshotComparable = { ...emptySnapshot(), channels: new Map([[10n, updatedChannel]]) };

			const diff = CreateSnapshotDiff(base, target);

			expect(diff.channels.get(10n)).toEqual({ change_type: DIFF_CHANGE_TYPE.UPDATE, ...updatedChannel });
		});
	});

	describe('Bans', () => {
		it('returns created bans', () => {
			const base = emptySnapshot();
			const newBan = makeBan();
			const target: SnapshotComparable = { ...emptySnapshot(), bans: new Map([[30n, newBan]]) };

			const diff = CreateSnapshotDiff(base, target);

			expect(diff.bans.size).toBe(1);
			expect(diff.bans.get(30n)).toEqual({ change_type: DIFF_CHANGE_TYPE.CREATE, ...newBan });
		});

		it('returns deleted bans', () => {
			const oldBan = makeBan();
			const base: SnapshotComparable = { ...emptySnapshot(), bans: new Map([[30n, oldBan]]) };
			const target = emptySnapshot();

			const diff = CreateSnapshotDiff(base, target);

			expect(diff.bans.size).toBe(1);
			expect(diff.bans.get(30n)).toEqual({ change_type: DIFF_CHANGE_TYPE.DELETE, ...oldBan });
		});

		it('returns updated bans', () => {
			const base: SnapshotComparable = {
				...emptySnapshot(),
				bans: new Map([[30n, makeBan({ reason: 'Old reason' })]])
			};
			const target: SnapshotComparable = {
				...emptySnapshot(),
				bans: new Map([[30n, makeBan({ reason: 'New reason' })]])
			};

			const diff = CreateSnapshotDiff(base, target);

			expect(diff.bans.size).toBe(1);
			expect(diff.bans.get(30n)).toEqual({ change_type: DIFF_CHANGE_TYPE.UPDATE, id: 30n, reason: 'New reason' });
		});
	});

	it('returns the entire target snapshot as CREATE if base is empty', () => {
		const base = emptySnapshot();
		const role = makeBotRole();
		const channel = makeChannel();
		const ban = makeBan();
		const target: SnapshotComparable = {
			roles: new Map([[BOT_ID, role]]),
			channels: new Map([[10n, channel]]),
			bans: new Map([[30n, ban]])
		};

		const diff = CreateSnapshotDiff(base, target);

		expect(diff.roles.get(BOT_ID)).toEqual({ change_type: DIFF_CHANGE_TYPE.CREATE, ...role });
		expect(diff.channels.get(10n)).toEqual({ change_type: DIFF_CHANGE_TYPE.CREATE, ...channel });
		expect(diff.bans.get(30n)).toEqual({ change_type: DIFF_CHANGE_TYPE.CREATE, ...ban });
	});

	it('returns the entire base snapshot as DELETE if target is empty', () => {
		const role = makeBotRole();
		const channel = makeChannel();
		const ban = makeBan();
		const base: SnapshotComparable = {
			roles: new Map([[BOT_ID, role]]),
			channels: new Map([[10n, channel]]),
			bans: new Map([[30n, ban]])
		};
		const target = emptySnapshot();

		const diff = CreateSnapshotDiff(base, target);

		expect(diff.roles.get(BOT_ID)).toEqual({ change_type: DIFF_CHANGE_TYPE.DELETE, ...role });
		expect(diff.channels.get(10n)).toEqual({ change_type: DIFF_CHANGE_TYPE.DELETE, ...channel });
		expect(diff.bans.get(30n)).toEqual({ change_type: DIFF_CHANGE_TYPE.DELETE, ...ban });
	});

	it('returns nothing if both snapshots are the same', () => {
		// permission_overwrites is independently constructed on each side (not shared by reference)
		// so this also guards against comparing the nested overwrite objects by reference instead of by value.
		const base: SnapshotComparable = {
			roles: new Map([[BOT_ID, makeBotRole()]]),
			channels: new Map([[10n, makeChannel({ permission_overwrites: { '500': { allow: '8', deny: '0', type: 0 } } })]]),
			bans: new Map([[30n, makeBan()]])
		};
		const target: SnapshotComparable = {
			roles: new Map([[BOT_ID, makeBotRole()]]),
			channels: new Map([[10n, makeChannel({ permission_overwrites: { '500': { allow: '8', deny: '0', type: 0 } } })]]),
			bans: new Map([[30n, makeBan()]])
		};

		const diff = CreateSnapshotDiff(base, target);

		expect(diff.roles.size).toBe(0);
		expect(diff.channels.size).toBe(0);
		expect(diff.bans.size).toBe(0);
	});
});
