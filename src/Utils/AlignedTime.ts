import { SECONDS } from "./Constants.js";

/**
 * How to snap a timestamp that falls in the middle of an interval.
 *
 * - `floor` - the start of the interval the timestamp is inside of
 * - `ceil`  - the start of the next interval
 */
export type AlignMode = 'floor' | 'ceil';

function IntervalMS(interval: number) {
	if (!Number.isFinite(interval) || interval <= 0) {
		throw new RangeError('interval must be a finite number greater than 0 seconds');
	}

	return interval * 1000;
}

/**
 * Snaps a timestamp to an interval boundary, so every window built from it covers
 * the exact same amount of time instead of ending part way through an interval.
 *
 * Boundaries are counted from the unix epoch, which is a UTC midnight - so `SECONDS.HOUR`
 * lands on the top of the hour and `SECONDS.DAY` lands on UTC midnight. Intervals that do
 * not divide a day evenly (`SECONDS.WEEK` lands on a Thursday, `SECONDS.MONTH` is a flat
 * 30 days) need `anchor` to line up with a calendar.
 *
 * @param timestamp Milliseconds, as from `Date.now()`
 * @param interval  Interval length in **seconds**, ie one of `SECONDS`
 * @param mode      Snap down (default) or up
 * @param anchor    Milliseconds to count boundaries from, defaults to the unix epoch
 * @returns Milliseconds, always exactly on an interval boundary
 */
export function AlignTime(timestamp: number, interval: number, mode: AlignMode = 'floor', anchor = 0): number {
	if (!Number.isFinite(timestamp)) throw new TypeError('timestamp must be a finite number');
	if (!Number.isFinite(anchor)) throw new TypeError('anchor must be a finite number');

	const intervalMS = IntervalMS(interval);
	const offset = timestamp - anchor;
	const boundary = mode === 'ceil'
		? Math.ceil(offset / intervalMS)
		: Math.floor(offset / intervalMS);

	return anchor + boundary * intervalMS;
}

/**
 * `Date.now()` snapped to an interval boundary.
 *
 * Defaults to `floor`, which is the start of the interval currently in progress - ie the
 * end of the last *complete* interval. Use `ceil` when the partial interval should still
 * be treated as a whole one.
 *
 * @param interval Interval length in **seconds**, ie one of `SECONDS`
 * @param mode     Snap down (default) or up
 * @param anchor   Milliseconds to count boundaries from, defaults to the unix epoch
 */
export function AlignedNow(interval: number, mode: AlignMode = 'floor', anchor = 0): number {
	return AlignTime(Date.now(), interval, mode, anchor);
}

/**
 * A time range ending on an interval boundary and spanning exactly `count` whole intervals.
 *
 * Both ends are inclusive and the range stops 1ms short of the boundary, so bucketing it at
 * `interval` produces exactly `count` buckets with no trailing partial bucket - the case
 * that leaves a graph with a final column holding 6 hours of data next to columns holding 24.
 *
 * By default the interval in progress is dropped (`includePartial: false`). Pass
 * `includePartial: true` to keep it as the last bucket, knowing it is still filling up.
 *
 * @param interval Interval length in **seconds**, ie one of `SECONDS`
 * @param count    How many whole intervals the range should cover
 */
export function AlignedWindow(interval: number, count: number, options?: {
	includePartial?: boolean,
	anchor?: number,
}): [start: number, end: number] {
	if (!Number.isInteger(count) || count <= 0) {
		throw new RangeError('count must be an integer greater than 0');
	}

	const intervalMS = IntervalMS(interval);
	const end = AlignedNow(interval, options?.includePartial ? 'ceil' : 'floor', options?.anchor ?? 0);

	return [end - count * intervalMS, end - 1];
}

/**
 * The interval boundary a timestamp falls on, as whole seconds, for `<t:...>` timestamps.
 *
 * @param interval Interval length in **seconds**, ie one of `SECONDS`
 */
export function AlignedUnix(timestamp: number, interval: number = SECONDS.MINUTE, mode: AlignMode = 'floor', anchor = 0): number {
	return Math.floor(AlignTime(timestamp, interval, mode, anchor) / 1000);
}
