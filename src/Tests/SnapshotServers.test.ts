import { describe, it, expect, vi, beforeEach } from 'vitest';

const { GetGuild } = vi.hoisted(() => ({ GetGuild: vi.fn() }));
vi.mock('../CRUD/Guilds.js', () => ({ GetGuild }));

const { CreateSnapshot } = vi.hoisted(() => ({ CreateSnapshot: vi.fn(async () => 1) }));
vi.mock('../CRUD/Snapshots.js', () => ({ CreateSnapshot }));

vi.mock('../Utils/Tasks/PurgeSnapshots.js', () => ({ PurgeSnapshots: vi.fn(async () => {}) }));

import { client } from '../Client.js';
import { SnapshotServers } from '../Utils/Tasks/SnapshotServers.js';
import { GUILD_FEATURES, SimpleGuild } from '../Typings/DatabaseTypes.js';

// pick a guild id whose value % 24 equals the current UTC hour, matching the task's own hourly-sharding check
const currentHour = new Date().getUTCHours();
const guildId = String(currentHour);

beforeEach(() => {
	GetGuild.mockReset();
	CreateSnapshot.mockClear();
	client.guilds.cache.clear();
	// @ts-expect-error - minimal fake guild, only `id`/`name` are read by SnapshotServers
	client.guilds.cache.set(guildId, { id: guildId, name: 'Test Guild' });
});

describe('SnapshotServers', () => {
	it('does not snapshot a guild that has not opted into AUTOMATIC_SNAPSHOTS, even in DEV_MODE', async () => {
		process.env.DEV_MODE = '1';
		const guild: SimpleGuild = { id: BigInt(guildId), name: 'Test Guild', features: 0, last_restore: 0n };
		GetGuild.mockResolvedValue(guild);

		await SnapshotServers();

		expect(CreateSnapshot).not.toHaveBeenCalled();
		delete process.env.DEV_MODE;
	});

	it('snapshots a guild that has opted into AUTOMATIC_SNAPSHOTS', async () => {
		const guild: SimpleGuild = { id: BigInt(guildId), name: 'Test Guild', features: GUILD_FEATURES.AUTOMATIC_SNAPSHOTS, last_restore: 0n };
		GetGuild.mockResolvedValue(guild);

		await SnapshotServers();

		expect(CreateSnapshot).toHaveBeenCalled();
	});
});
