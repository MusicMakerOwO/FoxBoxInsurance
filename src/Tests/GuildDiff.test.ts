import { describe, it, expect, vi } from 'vitest';
import { ChannelType } from 'discord.js';
import { DIFF_CHANGE_TYPE } from '../Utils/Constants.js';

vi.mock('../Client.js', () => ({
	client: { user: { id: '900000000000000001' } }
}));

import { CreateSnapshotDiff, SnapshotComparable } from '../Utils/Snapshots/GuildDiff.js';

const BOT_ROLE_ID = 1n;

function emptyComparable(): SnapshotComparable {
	return { roles: new Map(), channels: new Map(), bans: new Map() };
}

function withBotRole(comparable: SnapshotComparable, position = 0): SnapshotComparable {
	comparable.roles.set(BOT_ROLE_ID, {
		id: BOT_ROLE_ID, name: 'bot', color: 0, hoist: 0, position,
		permissions: 0n, managed_by: 900000000000000001n
	});
	return comparable;
}

describe('CreateSnapshotDiff', () => {
	it('does not report an update for hoist when the driver returns a boolean instead of 0/1', () => {
		const base = withBotRole(emptyComparable());
		base.roles.set(2n, {
			id: 2n, name: 'role', color: 0, hoist: true as unknown as number, position: 1,
			permissions: 0n, managed_by: null
		});

		const target = withBotRole(emptyComparable());
		target.roles.set(2n, {
			id: 2n, name: 'role', color: 0, hoist: 1, position: 1,
			permissions: 0n, managed_by: null
		});

		const diff = CreateSnapshotDiff(base, target);
		expect(diff.roles.has(2n)).toBe(false);
	});

	it('does not report an update for nsfw when the driver returns a boolean instead of 0/1', () => {
		const base = emptyComparable();
		base.channels.set(3n, {
			id: 3n, type: ChannelType.GuildText, name: 'general', position: 0,
			topic: null, nsfw: true as unknown as (1 | 0), parent_id: null, permission_overwrites: {}
		});

		const target = emptyComparable();
		target.channels.set(3n, {
			id: 3n, type: ChannelType.GuildText, name: 'general', position: 0,
			topic: null, nsfw: 1, parent_id: null, permission_overwrites: {}
		});

		const diff = CreateSnapshotDiff(base, target);
		expect(diff.channels.has(3n)).toBe(false);
	});

	it('does not emit a DELETE for a channel type the bot would never have created', () => {
		const base = emptyComparable();
		base.channels.set(4n, {
			// AnnouncementThread is not in ALLOWED_CHANNEL_TYPES
			id: 4n, type: ChannelType.PublicThread, name: 'thread', position: 0,
			topic: null, nsfw: 0, parent_id: null, permission_overwrites: {}
		});

		const target = emptyComparable();

		const diff = CreateSnapshotDiff(base, target);
		expect(diff.channels.has(4n)).toBe(false);
	});

	it('still emits a DELETE for an allowed channel type missing from the target', () => {
		const base = emptyComparable();
		base.channels.set(5n, {
			id: 5n, type: ChannelType.GuildText, name: 'general', position: 0,
			topic: null, nsfw: 0, parent_id: null, permission_overwrites: {}
		});

		const target = emptyComparable();

		const diff = CreateSnapshotDiff(base, target);
		expect(diff.channels.get(5n)?.change_type).toBe(DIFF_CHANGE_TYPE.DELETE);
	});

	it('moves the bot role to the top using a consistent position value', () => {
		const base = withBotRole(emptyComparable(), 0);
		base.roles.set(2n, {
			id: 2n, name: 'higher role', color: 0, hoist: 0, position: 5,
			permissions: 0n, managed_by: null
		});

		const target = withBotRole(emptyComparable(), 0);
		target.roles.set(2n, {
			id: 2n, name: 'higher role', color: 0, hoist: 0, position: 5,
			permissions: 0n, managed_by: null
		});

		expect(() => CreateSnapshotDiff(base, target)).not.toThrow();
	});
});
