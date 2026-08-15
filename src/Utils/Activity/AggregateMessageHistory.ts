import { Database } from "../../Database.js";
import { MessageHistory } from "../../Typings/DatabaseTypes.js";

export type MessageHistoryBucket = {
	start: number,
	end: number,
	count: number,
}

function GetBucketStart(timestamp: number, bucketSize: number) {
	const bucketSizeMs = bucketSize * 1000;
	return Math.floor(timestamp / bucketSizeMs) * bucketSizeMs;
}

export async function AggregateMessageHistory(options: {
	guildID: bigint,
	channelID: bigint | null,
	timeRange: [start: number, end: number],
	bucketSize: number,
}): Promise<MessageHistoryBucket[]> {

	const [start, end] = options.timeRange;
	if (!Number.isFinite(options.bucketSize) || options.bucketSize <= 0) {
		throw new RangeError('bucketSize must be a finite number greater than 0 seconds');
	}

	const points = (await Database.query(`
		SELECT created_at FROM MessageHistory
		WHERE guild_id = ?
		AND (? IS NULL OR channel_id = ?)
		AND created_at BETWEEN ? AND ?
		ORDER BY created_at
	`, [
		options.guildID,
		options.channelID,
		options.channelID,
		start,
		end,
	]) as MessageHistory[]).map(x => Number(x.created_at));

	if (!Number.isFinite(start) || !Number.isFinite(end)) {
		throw new TypeError('timeRange must contain finite timestamps');
	}

	if (start > end) {
		throw new RangeError('timeRange start must be less than or equal to end');
	}

	const alignedStart = GetBucketStart(start, options.bucketSize);
	const alignedEnd = GetBucketStart(end, options.bucketSize);
	const counts = new Map<number, number>();

	for (const point of points) {
		if (point < start || point > end) continue;

		const bucketStart = GetBucketStart(point, options.bucketSize);
		counts.set(bucketStart, (counts.get(bucketStart) ?? 0) + 1);
	}

	const buckets: MessageHistoryBucket[] = [];
	for (let bucketStart = alignedStart; bucketStart <= alignedEnd;) {
		const nextBucketStart = bucketStart + (options.bucketSize * 1000);
		buckets.push({
			start: bucketStart,
			end: nextBucketStart,
			count: counts.get(bucketStart) ?? 0,
		});

		bucketStart = nextBucketStart;
	}

	return buckets;
}