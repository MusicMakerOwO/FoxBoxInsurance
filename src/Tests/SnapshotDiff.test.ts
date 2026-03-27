import { vi, describe, it, expect, assert } from 'vitest';
import { CreateSnapshotDiff, SnapshotComparable } from "../Utils/Snapshots/GuildDiff";
import {
	OVERWRITE_TYPE,
	SnapshotBan,
	SnapshotChannel,
	SnapshotChannelOverwrite,
	SnapshotRole
} from "../Typings/DatabaseTypes";
import { DIFF_CHANGE_TYPE } from "../Utils/Constants";
import { ObjectValues } from "../Typings/HelperTypes";
import { JSONStringify } from "../JSON";

// @ts-ignore
vi.mock(import('../Client.js'), () => ({
	client: {
		user: {
			id: '1089343117142020319',
		}
	}
}))

type StripMetadata<T extends {}> = Omit<T, 'snapshot_id' | 'deleted'>;

const BOT_ROLE: StripMetadata<SnapshotRole> = {
	id: 1089343117142020319n,
	name: 'Fox Box Insurance',
	color: 0xff7900,
	hoist: 0,
	position: 1,
	managed_by: 1089343117142020319n,
	permissions: 0n
}

const EMPTY_SNAPSHOT: SnapshotComparable = {
	roles: new Map([[ BOT_ROLE.id, BOT_ROLE ]]),
	channels: new Map(),
	bans: new Map()
}

const role: StripMetadata<SnapshotRole> = {
	id: 2n,
	name: 'Test Role',
	color: 0x123456,
	hoist: 1,
	position: 1,
	managed_by: null,
	permissions: 0n
}

const channel: StripMetadata<SnapshotChannel> = {
	id: 1n,
	name: 'general',
	type: 0,
	position: 1,
	topic: "Pretty cool",
	nsfw: 0,
	parent_id: 2n,
	permission_overwrites: {}
}

const ban: StripMetadata<SnapshotBan> = {
	id: 1n,
	reason: "No reason provided"
}

const permission: JSONStringify<SnapshotChannelOverwrite> = {
	allow     : '1',
	deny      : '2',
	type      : OVERWRITE_TYPE.ROLE
}

function MockDiffEntry<T extends {}>(data: T, type: ObjectValues<typeof DIFF_CHANGE_TYPE>): (T & { change_type: ObjectValues<typeof DIFF_CHANGE_TYPE> }) {
	return { ... data, change_type: type }
}

describe('Snapshot diff', () => {
	describe('roles', () => {
		it('errors if there is no bot role and there is at least 1 role', () => {
			const empty = {
				roles: new Map([
					[role.id, role]
				]),
				channels: new Map(),
				bans: new Map(),
				permissions: new Map()
			}

			assert.throws(() => CreateSnapshotDiff(empty, empty), 'Could not find a bot role in the provided guild - Was the bot given no permissions upon invite?');
			assert.doesNotThrow(() => CreateSnapshotDiff(EMPTY_SNAPSHOT, EMPTY_SNAPSHOT))
		});

		it('does not error if roles are empty', () => {
			const empty = {
				roles: new Map(),
				channels: new Map(),
				bans: new Map(),
				permissions: new Map()
			}

			assert.doesNotThrow(() => CreateSnapshotDiff(empty, empty), 'Could not find a bot role in the provided guild - Was the bot given no permissions upon invite?');
			assert.doesNotThrow(() => CreateSnapshotDiff(EMPTY_SNAPSHOT, EMPTY_SNAPSHOT))
		});

		it('returns created roles', () => {
			const data: SnapshotComparable = {
				... EMPTY_SNAPSHOT,
				roles: new Map([[BOT_ROLE.id, BOT_ROLE], [role.id, role]]),
			}

			const diff = CreateSnapshotDiff(EMPTY_SNAPSHOT, data);

			expect(diff.roles.size).toBe(1);
			expect(diff.roles.get(role.id)).toEqual(MockDiffEntry(role, DIFF_CHANGE_TYPE.CREATE));
		});

		it('returns deleted roles', () => {
			const data: SnapshotComparable = {
				... EMPTY_SNAPSHOT,
				roles: new Map([[BOT_ROLE.id, BOT_ROLE], [role.id, role]]),
			}

			const diff = CreateSnapshotDiff(data, EMPTY_SNAPSHOT);

			expect(diff.roles.size).toBe(1);
			expect(diff.roles.get(role.id)).toEqual(MockDiffEntry(role, DIFF_CHANGE_TYPE.DELETE));
		})

		it('returns updated roles', () => {
			const updatedRole: typeof role = {
				... role,
				name       : 'Updated Role',
				color      : 0x000000,
				hoist      : 0,
				position   : 0,
				managed_by : BOT_ROLE.id,
				permissions: 1n
			}

			const orgData: SnapshotComparable = {
				... EMPTY_SNAPSHOT,
				roles: new Map([[BOT_ROLE.id, BOT_ROLE], [role.id, role]]),
			}

			const newData: SnapshotComparable = {
				... EMPTY_SNAPSHOT,
				roles: new Map([[BOT_ROLE.id, BOT_ROLE], [updatedRole.id, updatedRole]]),
			}

			const diff = CreateSnapshotDiff(orgData, newData);

			expect(diff.roles.size).toBe(1);
			expect(diff.roles.get(role.id)).toEqual(MockDiffEntry(updatedRole, DIFF_CHANGE_TYPE.UPDATE));
		})
	});

	describe('channels', () => {
		it('returns created channel', () => {
			const data: SnapshotComparable = {
				... EMPTY_SNAPSHOT,
				channels: new Map([[ channel.id, channel ]])
			}

			const diff = CreateSnapshotDiff(EMPTY_SNAPSHOT, data);

			expect(diff.channels.size).toBe(1);
			expect(diff.channels.get(channel.id)).toEqual(MockDiffEntry(channel, DIFF_CHANGE_TYPE.CREATE));
		});

		it('returns deleted channels', () => {
			const data: SnapshotComparable = {
				... EMPTY_SNAPSHOT,
				channels: new Map([[ channel.id, channel ]])
			}

			const diff = CreateSnapshotDiff(data, EMPTY_SNAPSHOT);

			expect(diff.channels.size).toBe(1);
			expect(diff.channels.get(channel.id)).toEqual(MockDiffEntry(channel, DIFF_CHANGE_TYPE.DELETE));
		});

		it('returns updated channels', () => {
			const updatedChannel: typeof channel = {
				... channel,
				name: 'memes',
				type: 0,
				position: 2,
				topic: "haha funny",
				nsfw: 1,
				parent_id: 0n
			}

			const orgData: SnapshotComparable = {
				... EMPTY_SNAPSHOT,
				channels: new Map([[ channel.id, channel ]])
			}

			const newData: SnapshotComparable = {
				... EMPTY_SNAPSHOT,
				channels: new Map([[ updatedChannel.id, updatedChannel ]]),
			}

			const diff = CreateSnapshotDiff(orgData, newData);

			expect(diff.channels.size).toBe(1);
			expect(diff.channels.get(channel.id)).toEqual(MockDiffEntry(updatedChannel, DIFF_CHANGE_TYPE.UPDATE));
		});
	});

	describe('channel permissions', () => {
		it('returns updated channel with added permission', () => {
			const updatedChannel: typeof channel = {
				... channel,
				permission_overwrites: {
					'1': permission
				}
			}

			const orgData: SnapshotComparable = {
				... EMPTY_SNAPSHOT,
				channels: new Map([[ channel.id, channel ]])
			}

			const newData: SnapshotComparable = {
				... EMPTY_SNAPSHOT,
				channels: new Map([[ updatedChannel.id, updatedChannel ]]),
			}

			const diff = CreateSnapshotDiff(orgData, newData);

			expect(diff.channels.size).toBe(1);
			expect(diff.channels.get(channel.id)).toEqual(MockDiffEntry(updatedChannel, DIFF_CHANGE_TYPE.UPDATE));
			expect(diff.channels.get(channel.id)!.permission_overwrites).toEqual(updatedChannel.permission_overwrites);
		});

		it('returns updated channel with removed permission', () => {
			const orgChannel: typeof channel = {
				... channel,
				permission_overwrites: {
					'1': permission
				}
			}

			const orgData: SnapshotComparable = {
				... EMPTY_SNAPSHOT,
				channels: new Map([[ orgChannel.id, orgChannel ]])
			}

			const newData: SnapshotComparable = {
				... EMPTY_SNAPSHOT,
				channels: new Map([[ channel.id, channel ]]),
			}

			const diff = CreateSnapshotDiff(orgData, newData);

			expect(diff.channels.size).toBe(1);
			expect(diff.channels.get(channel.id)).toEqual(MockDiffEntry(channel, DIFF_CHANGE_TYPE.UPDATE));
			expect(diff.channels.get(channel.id)!.permission_overwrites).toEqual(channel.permission_overwrites);
		});

		it('returns updated channel with modified permission', () => {
			const orgChannel: typeof channel = {
				... channel,
				permission_overwrites: {
					'1': permission
				}
			}

			const newChannel: typeof channel = {
				... channel,
				permission_overwrites: {
					'1': {
						... permission,
						allow: '100'
					}
				}
			}

			const newData: SnapshotComparable = {
				... EMPTY_SNAPSHOT,
				channels: new Map([[ newChannel.id, newChannel ]])
			}

			const orgData: SnapshotComparable = {
				... EMPTY_SNAPSHOT,
				channels: new Map([[ orgChannel.id, orgChannel ]]),
			}

			const diff = CreateSnapshotDiff(orgData, newData);

			expect(diff.channels.size).toBe(1);
			expect(diff.channels.get(channel.id)).toEqual(MockDiffEntry(newChannel, DIFF_CHANGE_TYPE.UPDATE));
			expect(diff.channels.get(channel.id)!.permission_overwrites).toEqual(newChannel.permission_overwrites);
		});
	});

	describe('bans', () => {
		it('returns created bans', () => {
			const data: SnapshotComparable = {
				... EMPTY_SNAPSHOT,
				bans: new Map([[ ban.id, ban ]])
			}

			const diff = CreateSnapshotDiff(EMPTY_SNAPSHOT, data);

			expect(diff.bans.size).toBe(1);
			expect(diff.bans.get(ban.id)).toEqual(MockDiffEntry(ban, DIFF_CHANGE_TYPE.CREATE));
		});

		it('returns deleted bans', () => {
			const data: SnapshotComparable = {
				... EMPTY_SNAPSHOT,
				bans: new Map([[ ban.id, ban ]])
			}

			const diff = CreateSnapshotDiff(data, EMPTY_SNAPSHOT);

			expect(diff.bans.size).toBe(1);
			expect(diff.bans.get(ban.id)).toEqual(MockDiffEntry(ban, DIFF_CHANGE_TYPE.DELETE));
		})

		it('returns updated bans', () => {
			const updatedBan: typeof ban = {
				... ban,
				reason: 'Bad'
			}

			const orgData: SnapshotComparable = {
				... EMPTY_SNAPSHOT,
				bans: new Map([[ ban.id, ban ]])
			}

			const newData: SnapshotComparable = {
				... EMPTY_SNAPSHOT,
				bans: new Map([[updatedBan.id, updatedBan]]),
			}

			const diff = CreateSnapshotDiff(orgData, newData);

			expect(diff.bans.size).toBe(1);
			expect(diff.bans.get(ban.id)).toEqual(MockDiffEntry(updatedBan, DIFF_CHANGE_TYPE.UPDATE));
		})
	});

	it('returns the entire target snapshot as CREATE if base is empty', () => {
		const targetData: SnapshotComparable = {
			roles: new Map([[role.id, role], [BOT_ROLE.id, BOT_ROLE]]),
			channels: new Map([[channel.id, channel]]),
			bans: new Map([[ban.id, ban]])
		}

		const diff = CreateSnapshotDiff(EMPTY_SNAPSHOT, targetData);

		expect(diff.roles.size).toBe(1);
		expect(diff.channels.size).toBe(1);
		expect(diff.bans.size).toBe(1);

		expect(diff.roles.get(role.id)).toEqual( MockDiffEntry(role, DIFF_CHANGE_TYPE.CREATE) );
		expect(diff.channels.get(channel.id)).toEqual( MockDiffEntry(channel, DIFF_CHANGE_TYPE.CREATE) );
		expect(diff.bans.get(ban.id)).toEqual( MockDiffEntry(ban, DIFF_CHANGE_TYPE.CREATE) );
	});

	it('returns the entire base snapshot as DELETE if target is empty', () => {
		const targetData: SnapshotComparable = {
			roles: new Map([[role.id, role], [BOT_ROLE.id, BOT_ROLE]]),
			channels: new Map([[channel.id, channel]]),
			bans: new Map([[ban.id, ban]])
		}

		const diff = CreateSnapshotDiff(targetData, EMPTY_SNAPSHOT);

		expect(diff.roles.size).toBe(1);
		expect(diff.channels.size).toBe(1);
		expect(diff.bans.size).toBe(1);

		expect(diff.roles.get(role.id)).toEqual( MockDiffEntry(role, DIFF_CHANGE_TYPE.DELETE) );
		expect(diff.channels.get(channel.id)).toEqual( MockDiffEntry(channel, DIFF_CHANGE_TYPE.DELETE) );
		expect(diff.bans.get(ban.id)).toEqual( MockDiffEntry(ban, DIFF_CHANGE_TYPE.DELETE) );
	});

	it('returns nothing is both snapshots are the same', () => {
		const targetData: SnapshotComparable = {
			roles: new Map([[role.id, role], [BOT_ROLE.id, BOT_ROLE]]),
			channels: new Map([[channel.id, channel]]),
			bans: new Map([[ban.id, ban]])
		}

		const diff = CreateSnapshotDiff(targetData, targetData);

		expect(diff.roles.size).toBe(0);
		expect(diff.channels.size).toBe(0);
		expect(diff.bans.size).toBe(0);
	});
})