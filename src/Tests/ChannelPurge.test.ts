import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SECONDS } from '../Utils/Constants.js';

const { getConnection, releaseConnection } = vi.hoisted(() => ({
	getConnection: vi.fn(),
	releaseConnection: vi.fn()
}));
vi.mock('../Database.js', () => ({ Database: { getConnection, releaseConnection } }));

import { ChannelPurge } from '../Utils/Tasks/ChannelPurge.js';

type ChannelCount = { message_count: bigint, channel_id: bigint };

function makeConnection(channelCounts: ChannelCount[] = []) {
	const query = vi.fn(async (sql: string, _params?: unknown[]) => {
		if (sql.includes('GROUP BY channel_id')) return channelCounts;
		return { affectedRows: 0n, insertId: 0n, warningStatus: 0 };
	});
	return { query };
}

beforeEach(() => {
	getConnection.mockReset();
	releaseConnection.mockReset();
});

describe('ChannelPurge', () => {
	it('removes messages older than sixty days but keeps messages at the cutoff and newer', async () => {
		const connection = makeConnection();
		getConnection.mockResolvedValue(connection);

		const before = Date.now();
		await ChannelPurge({ silent: true });

		const expiredCall = connection.query.mock.calls.find(([sql]) => sql.includes('DELETE FROM Messages WHERE created_at'));
		expect(expiredCall).toBeDefined();

		const [sql, params] = expiredCall!;
		// strict "<" (not "<=") means a message created exactly at the cutoff is kept, not deleted
		expect(sql).toContain('created_at < ?');

		const cutoff = (params as [Date])[0].getTime();
		const expectedCutoff = before - SECONDS.DAY * 60 * 1000;
		expect(Math.abs(cutoff - expectedCutoff)).toBeLessThan(5000); // small tolerance for test execution time
	});

	it('keeps only the newest ten thousand messages for overflowing channels', async () => {
		const connection = makeConnection([{ channel_id: 111n, message_count: 10050n }]);
		getConnection.mockResolvedValue(connection);

		await ChannelPurge({ silent: true });

		const overflowCall = connection.query.mock.calls.find(([sql, params]) =>
			sql.includes('DELETE FROM Messages') && sql.includes('LIMIT') && (params as unknown[])[0] === 111n
		);
		expect(overflowCall).toBeDefined();
		expect(overflowCall![1]).toEqual([111n, 50n]);
	});

	it('leaves channels at or below the limit untouched and removes channels with no remaining messages', async () => {
		const connection = makeConnection([{ channel_id: 222n, message_count: 10000n }]);
		getConnection.mockResolvedValue(connection);

		await ChannelPurge({ silent: true });

		const overflowCall = connection.query.mock.calls.find(([sql, params]) =>
			sql.includes('DELETE FROM Messages') && sql.includes('LIMIT') && (params as unknown[])[0] === 222n
		);
		expect(overflowCall).toBeUndefined();

		const emptyChannelCall = connection.query.mock.calls.find(([sql]) => sql.includes('DELETE FROM Channels'));
		expect(emptyChannelCall).toBeDefined();
	});
});
