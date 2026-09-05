/**
 * Calendar boundaries in an IANA timezone.
 *
 * `AlignedTime.ts` snaps to fixed intervals counted from the epoch, which is enough while every
 * boundary is a UTC one. A user's day is not a fixed interval: it starts at their local midnight,
 * and daylight saving makes two days a year 23 or 25 hours long. Anything that adds
 * `SECONDS.DAY * 1000` to walk forward drifts by an hour the moment it crosses a transition.
 *
 * These helpers resolve the zone's offset *per instant* rather than once, so boundaries stay on
 * local midnight all the way through a window.
 *
 * Known limitation: callers that bucket at whole hours (`AggregateMessageHistory`) floor to epoch
 * hour multiples, which line up with local hour boundaries only in whole-hour zones. In the half
 * hour zones `Utils/Timezones.ts` offers - `Asia/Kolkata` (+5:30), `America/St_Johns` (-3:30),
 * `Australia/Adelaide` (+9:30) - the day still starts on local midnight, but each hourly slot
 * covers HH:30 to HH:30 local. Fixing that needs 30 minute buckets, not a different day start.
 */

const FORMATTERS = new Map<string, Intl.DateTimeFormat>();

function Formatter(zone: string): Intl.DateTimeFormat {
	let formatter = FORMATTERS.get(zone);
	if (!formatter) {
		formatter = new Intl.DateTimeFormat('en-US', {
			timeZone: zone,
			hourCycle: 'h23',
			year: 'numeric',
			month: '2-digit',
			day: '2-digit',
			hour: '2-digit',
			minute: '2-digit',
			second: '2-digit'
		});
		FORMATTERS.set(zone, formatter);
	}

	return formatter;
}

/**
 * How far ahead of UTC a zone is at a given instant, in milliseconds.
 *
 * Resolved at `timestamp`, so the same zone returns different values either side of a daylight
 * saving transition - `America/Chicago` is -5h in July and -6h in January.
 *
 * @param zone      IANA zone, ie an `iana` value from `Utils/Timezones.ts`
 * @param timestamp Milliseconds, as from `Date.now()`
 */
export function ZoneOffset(zone: string, timestamp: number): number {
	if (!Number.isFinite(timestamp)) throw new TypeError('timestamp must be a finite number');

	const parts = Formatter(zone).formatToParts(new Date(timestamp));
	const field: Partial<Record<Intl.DateTimeFormatPartTypes, number>> = {};
	for (const part of parts) {
		if (part.type !== 'literal') field[part.type] = Number(part.value);
	}

	const wallClock = Date.UTC(
		field.year!, field.month! - 1, field.day!,
		// 'h23' still renders midnight as 24 in some ICU versions
		field.hour! % 24, field.minute!, field.second!
	);

	// The formatted fields carry no milliseconds, so compare against a whole second of the input
	return wallClock - (timestamp - (timestamp % 1000));
}

/**
 * A `Date` whose **UTC** fields read as the zone's local wall clock.
 *
 * Not the same instant as `timestamp` - it is deliberately shifted so that `getUTCDate()`,
 * `getUTCDay()` and friends return local calendar values. That makes it a drop-in for code that
 * already reads dates with `getUTC*` (every activity renderer does) without touching that code.
 * Do not use it for arithmetic against real timestamps.
 *
 * @param zone      IANA zone, ie an `iana` value from `Utils/Timezones.ts`
 * @param timestamp Milliseconds, as from `Date.now()`
 */
export function ZonedDate(zone: string, timestamp: number): Date {
	return new Date(timestamp + ZoneOffset(zone, timestamp));
}

/**
 * The instant a local calendar date begins, resolved through the offset in effect *at that
 * boundary* rather than the offset in effect now.
 */
function StartOfDay(zone: string, year: number, month: number, day: number): number {
	const wallClock = Date.UTC(year, month, day);

	// Two passes: the offset at the naive UTC value gets us within an hour of the real boundary,
	// then the offset at that candidate is the one actually in effect on the local day. Without
	// the second pass a boundary sitting just past a transition resolves with the old offset.
	const candidate = wallClock - ZoneOffset(zone, wallClock);
	return wallClock - ZoneOffset(zone, candidate);
}

/**
 * `count` consecutive local midnights, oldest first, ending with the local day that `timestamp`
 * falls in.
 *
 * Days are walked as calendar dates - `Date.UTC` normalises the month and year rollover - so the
 * gap between neighbours is 23, 24 or 25 hours depending on daylight saving, and every entry lands
 * on local midnight regardless.
 *
 * @param zone      IANA zone, ie an `iana` value from `Utils/Timezones.ts`
 * @param timestamp Milliseconds, as from `Date.now()`
 * @param count     How many days the window covers, including the day `timestamp` is in
 */
export function ZonedDayStarts(zone: string, timestamp: number, count: number): number[] {
	if (!Number.isInteger(count) || count <= 0) {
		throw new RangeError('count must be an integer greater than 0');
	}

	const today = ZonedDate(zone, timestamp);
	const year = today.getUTCFullYear();
	const month = today.getUTCMonth();
	const day = today.getUTCDate();

	const starts: number[] = [];
	for (let i = count - 1; i >= 0; i--) {
		starts.push(StartOfDay(zone, year, month, day - i));
	}

	return starts;
}
