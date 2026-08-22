import { describe, it, expect, vi, beforeEach } from 'vitest';

const { getConnection, releaseConnection, query, schedule } = vi.hoisted(() => ({
	getConnection: vi.fn(),
	releaseConnection: vi.fn(),
	query: vi.fn(),
	schedule: vi.fn()
}));
vi.mock('../Database.js', () => ({ Database: { getConnection, releaseConnection, query } }));
vi.mock('../Utils/TaskScheduler.js', () => ({ TaskScheduler: { schedule } }));

// TASKS validates `callback.constructor.name === 'AsyncFunction'`, which a vi.fn() mock
// doesn't satisfy - use real async functions with manual call/throw tracking instead.
const { channelPurgeState, channelPurge } = vi.hoisted(() => {
	const channelPurgeState = { calls: 0, shouldThrow: false };
	async function channelPurge() {
		channelPurgeState.calls++;
		if (channelPurgeState.shouldThrow) throw new Error('boom');
	}
	return { channelPurgeState, channelPurge };
});
vi.mock('../Utils/Tasks/SnapshotServers.js', () => ({ SnapshotServers: async () => {} }));
vi.mock('../Utils/Tasks/PushStats.js', () => ({ PushStats: async () => {} }));
vi.mock('../Utils/Tasks/ChannelPurge.js', () => ({ ChannelPurge: channelPurge }));
vi.mock('../Utils/Tasks/EncryptMessages.js', () => ({ EncryptMessages: async () => {} }));
vi.mock('../Utils/Tasks/UploadFiles.js', () => ({ UploadFiles: async () => {} }));

import { StartAutomaticTasks } from '../Utils/Tasks/AutomaticTasks.js';

async function scheduleAndRunChannelPurgeCallback() {
	await StartAutomaticTasks();

	// find the scheduled callback that invokes ChannelPurge and run it directly
	for (const [cb] of schedule.mock.calls) {
		const before = channelPurgeState.calls;
		query.mockClear();
		await cb();
		if (channelPurgeState.calls > before) return;
	}

	throw new Error('channel_purge callback was never scheduled/invoked');
}

beforeEach(() => {
	getConnection.mockReset();
	releaseConnection.mockReset();
	query.mockReset();
	schedule.mockReset();
	channelPurgeState.calls = 0;
	channelPurgeState.shouldThrow = false;

	getConnection.mockResolvedValue({ query: vi.fn().mockResolvedValue([]) });
	query.mockResolvedValue({ affectedRows: 1n });
});

describe('StartAutomaticTasks', () => {
	it('does not record last_run when the task throws', async () => {
		channelPurgeState.shouldThrow = true;

		await scheduleAndRunChannelPurgeCallback();

		expect(query).not.toHaveBeenCalledWith(expect.stringContaining('INSERT INTO Timers'), expect.anything());
	});

	it('records last_run when the task succeeds', async () => {
		channelPurgeState.shouldThrow = false;

		await scheduleAndRunChannelPurgeCallback();

		expect(query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO Timers'), expect.anything());
	});
});
