import { describe, it, expect, vi, beforeEach } from 'vitest';

const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('../Database.js', () => ({ Database: { query } }));

import { AggregateMessageHistory } from '../Utils/Activity/AggregateMessageHistory.js';

beforeEach(() => {
	query.mockReset();
});

describe('AggregateMessageHistory', () => {
	it('returns hour-aligned buckets with counts for points in range', async () => {
		query.mockResolvedValue([
			{ created_at: 500000n },
			{ created_at: 4000000n },
			{ created_at: 4500000n },
			{ created_at: 8000000n }
		]);

		const result = await AggregateMessageHistory({
			guildID: 1n,
			channelID: null,
			timeRange: [0, 10800000],
			bucketSize: 3600
		});

		expect(result).toEqual([
			{ start: 0, end: 3600000, count: 1 },
			{ start: 3600000, end: 7200000, count: 2 },
			{ start: 7200000, end: 10800000, count: 1 },
			{ start: 10800000, end: 14400000, count: 0 }
		]);
	});

	it('returns zero-filled buckets for empty days in a range', async () => {
		query.mockResolvedValue([
			{ created_at: 1000n }, // day 0
			{ created_at: 172801000n } // day 2, day 1 left empty
		]);

		const result = await AggregateMessageHistory({
			guildID: 1n,
			channelID: null,
			timeRange: [0, 259199999], // extends into day 2 so its point isn't excluded by the range filter
			bucketSize: 86400
		});

		expect(result).toEqual([
			{ start: 0, end: 86400000, count: 1 },
			{ start: 86400000, end: 172800000, count: 0 },
			{ start: 172800000, end: 259200000, count: 1 }
		]);
	});

	it('uses fixed 30-day buckets for monthly aggregation', async () => {
		query.mockResolvedValue([]);
		const bucketSize = 30 * 86400; // seconds

		const result = await AggregateMessageHistory({
			guildID: 1n,
			channelID: null,
			timeRange: [0, 60 * 86400000],
			bucketSize
		});

		expect(result).toHaveLength(3);
		for (const bucket of result) {
			expect(bucket.end - bucket.start).toBe(bucketSize * 1000);
		}
	});

	it('rejects when time range contains a non-finite value', async () => {
		query.mockResolvedValue([]);

		await expect(AggregateMessageHistory({
			guildID: 1n,
			channelID: null,
			timeRange: [Number.NaN, 100],
			bucketSize: 3600
		})).rejects.toThrow('timeRange must contain finite timestamps');
	});

	it('rejects when start is after end', async () => {
		query.mockResolvedValue([]);

		await expect(AggregateMessageHistory({
			guildID: 1n,
			channelID: null,
			timeRange: [100, 0],
			bucketSize: 3600
		})).rejects.toThrow('timeRange start must be less than or equal to end');
	});
});
