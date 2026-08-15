import { afterEach, describe, expect, it, vi } from 'vitest';

import { Database } from '../Database.js';
import { AggregateMessageHistory } from '../Utils/Activity/AggregateMessageHistory.js';
import { SECONDS } from "../Utils/Constants.js";

describe('AggregateMessageHistory', () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('returns hour-aligned buckets with counts for points in range', async () => {
		vi.spyOn(Database, 'query').mockResolvedValue([
			{ created_at: BigInt(Date.UTC(2026, 5, 29, 14, 39)) },
			{ created_at: BigInt(Date.UTC(2026, 5, 29, 14, 59, 59)) },
			{ created_at: BigInt(Date.UTC(2026, 5, 29, 15, 0)) },
			{ created_at: BigInt(Date.UTC(2026, 5, 29, 15, 45)) },
			{ created_at: BigInt(Date.UTC(2026, 5, 29, 16, 1)) },
		] as Awaited<ReturnType<typeof Database.query>>);

		const buckets = await AggregateMessageHistory({
			guildID: 1n,
			channelID: null,
			timeRange: [Date.UTC(2026, 5, 29, 14, 38), Date.UTC(2026, 5, 29, 16, 5)],
			bucketSize: SECONDS.HOUR
		});

		expect(buckets).toEqual([
			{ start: Date.UTC(2026, 5, 29, 14, 0), end: Date.UTC(2026, 5, 29, 15, 0), count: 2 },
			{ start: Date.UTC(2026, 5, 29, 15, 0), end: Date.UTC(2026, 5, 29, 16, 0), count: 2 },
			{ start: Date.UTC(2026, 5, 29, 16, 0), end: Date.UTC(2026, 5, 29, 17, 0), count: 1 },
		]);
	});

	it('returns zero-filled buckets for empty days in a range', async () => {
		vi.spyOn(Database, 'query').mockResolvedValue([
			{ created_at: BigInt(Date.UTC(2026, 5, 11, 10, 0)) },
		] as Awaited<ReturnType<typeof Database.query>>);

		const buckets = await AggregateMessageHistory({
			guildID: 1n,
			channelID: 5n,
			timeRange: [Date.UTC(2026, 5, 10, 8, 0), Date.UTC(2026, 5, 12, 20, 0)],
			bucketSize: SECONDS.DAY,
		});

		expect(buckets).toEqual([
			{ start: Date.UTC(2026, 5, 10, 0, 0), end: Date.UTC(2026, 5, 11, 0, 0), count: 0 },
			{ start: Date.UTC(2026, 5, 11, 0, 0), end: Date.UTC(2026, 5, 12, 0, 0), count: 1 },
			{ start: Date.UTC(2026, 5, 12, 0, 0), end: Date.UTC(2026, 5, 13, 0, 0), count: 0 },
		]);
	});

	it('uses fixed 30-day buckets for monthly aggregation', async () => {
		vi.spyOn(Database, 'query').mockResolvedValue([
			{ created_at: BigInt(Date.UTC(2026, 1, 14, 12, 0)) },
		] as Awaited<ReturnType<typeof Database.query>>);

		const buckets = await AggregateMessageHistory({
			guildID: 1n,
			channelID: null,
			timeRange: [Date.UTC(2026, 0, 15, 8, 0), Date.UTC(2026, 2, 20, 20, 0)],
			bucketSize: SECONDS.MONTH,
		});

		expect(buckets).toEqual([
			{ start: Date.UTC(2026, 0, 7, 0, 0), end: Date.UTC(2026, 1, 6, 0, 0), count: 0 },
			{ start: Date.UTC(2026, 1, 6, 0, 0), end: Date.UTC(2026, 2, 8, 0, 0), count: 1 },
			{ start: Date.UTC(2026, 2, 8, 0, 0), end: Date.UTC(2026, 3, 7, 0, 0), count: 0 },
		]);
	});

	it('rejects when time range contains a non-finite value', async () => {
		vi.spyOn(Database, 'query').mockResolvedValue([] as Awaited<ReturnType<typeof Database.query>>);

		await expect(AggregateMessageHistory({
			guildID: 1n,
			channelID: null,
			timeRange: [Number.NaN, Date.now()],
			bucketSize: SECONDS.HOUR,
		})).rejects.toThrow(TypeError);
	});

	it('rejects when start is after end', async () => {
		vi.spyOn(Database, 'query').mockResolvedValue([] as Awaited<ReturnType<typeof Database.query>>);

		await expect(AggregateMessageHistory({
			guildID: 1n,
			channelID: null,
			timeRange: [Date.UTC(2026, 5, 30), Date.UTC(2026, 5, 29)],
			bucketSize: SECONDS.WEEK,
		})).rejects.toThrow(RangeError);
	});
});