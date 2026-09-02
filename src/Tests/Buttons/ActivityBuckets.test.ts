import { describe, expect, it } from "vitest";
import { buildDayBuckets } from "../../Buttons/Activity.js";
import { ZonedDate, ZonedDayStarts } from "../../Utils/ZonedTime.js";
import { SECONDS } from "../../Utils/Constants.js";

const HOUR = SECONDS.HOUR * 1000;

/** One hourly point per given instant, so a slot landing anywhere is unambiguous. */
function points(...starts: number[]) {
	return starts.map(start => ({ start, count: 1 }));
}

const CHICAGO = 'America/Chicago';
// 2026-07-15 12:00 UTC, ie 07:00 CDT. No DST transition anywhere near it.
const SUMMER = Date.UTC(2026, 6, 15, 12);

describe('buildDayBuckets', () => {
	it('puts a point just after local midnight in hour 0 of that day', () => {
		const dayStarts = ZonedDayStarts(CHICAGO, SUMMER, 7);
		// 2026-07-15 00:00 CDT is 05:00 UTC - under the old UTC bucketing this landed in
		// hour 19 of the previous row
		const days = buildDayBuckets(dayStarts, CHICAGO, points(Date.UTC(2026, 6, 15, 5)));

		expect(days[6].hours[0]).toBe(1);
		expect(days[5].hours[19]).toBe(0);
	});

	it('puts a point just before local midnight in hour 23 of the previous day', () => {
		const dayStarts = ZonedDayStarts(CHICAGO, SUMMER, 7);
		const days = buildDayBuckets(dayStarts, CHICAGO, points(Date.UTC(2026, 6, 15, 4)));

		expect(days[5].hours[23]).toBe(1);
		expect(days[6].hours[0]).toBe(0);
	});

	it('labels each row with its local calendar date', () => {
		const days = buildDayBuckets(ZonedDayStarts(CHICAGO, SUMMER, 7), CHICAGO, []);

		expect(days.map(day => day.date.getUTCDate())).toEqual([9, 10, 11, 12, 13, 14, 15]);
	});

	it('gives every day exactly 24 slots', () => {
		const days = buildDayBuckets(ZonedDayStarts(CHICAGO, SUMMER, 7), CHICAGO, []);

		expect(days).toHaveLength(7);
		for (const day of days) expect(day.hours).toHaveLength(24);
	});

	it('drops points from before the window', () => {
		const dayStarts = ZonedDayStarts(CHICAGO, SUMMER, 7);
		const days = buildDayBuckets(dayStarts, CHICAGO, points(dayStarts[0] - HOUR));

		expect(days.flatMap(day => day.hours)).toEqual(new Array(7 * 24).fill(0));
	});

	it('spreads a full local day across all 24 slots', () => {
		const dayStarts = ZonedDayStarts(CHICAGO, SUMMER, 7);
		const hours = new Array(24).fill(0).map((_, i) => dayStarts[6] + i * HOUR);
		const days = buildDayBuckets(dayStarts, CHICAGO, points(...hours));

		expect(days[6].hours).toEqual(new Array(24).fill(1));
	});

	// A 25 hour day has nowhere to put its extra hour, so it folds into the last slot rather
	// than spilling into the next day or being dropped
	it('folds the extra hour of a fall back day into slot 23', () => {
		const dayStarts = ZonedDayStarts(CHICAGO, Date.UTC(2026, 10, 3, 12), 5); // Oct 30 - Nov 3
		const fallBack = dayStarts[2]; // 2026-11-01, 25 hours long
		expect(ZonedDate(CHICAGO, fallBack).getUTCDate()).toBe(1);

		const hours = new Array(25).fill(0).map((_, i) => fallBack + i * HOUR);
		const days = buildDayBuckets(dayStarts, CHICAGO, points(...hours));

		expect(days[2].hours[23]).toBe(2);
		expect(days[3].hours[0]).toBe(0);
		expect(days[2].hours.reduce((a, b) => a + b, 0)).toBe(25);
	});

	it('leaves a slot empty on a spring forward day', () => {
		const dayStarts = ZonedDayStarts(CHICAGO, Date.UTC(2026, 2, 10, 12), 5); // Mar 6 - Mar 10
		const springForward = dayStarts[2]; // 2026-03-08, 23 hours long
		expect(ZonedDate(CHICAGO, springForward).getUTCDate()).toBe(8);

		const hours = new Array(23).fill(0).map((_, i) => springForward + i * HOUR);
		const days = buildDayBuckets(dayStarts, CHICAGO, points(...hours));

		expect(days[2].hours[23]).toBe(0);
		expect(days[3].hours[0]).toBe(0);
		expect(days[2].hours.reduce((a, b) => a + b, 0)).toBe(23);
	});

	it('matches the old UTC behaviour when the viewer is on UTC', () => {
		const dayStarts = ZonedDayStarts('Etc/UTC', SUMMER, 7);
		const days = buildDayBuckets(dayStarts, 'Etc/UTC', points(Date.UTC(2026, 6, 15, 0)));

		expect(dayStarts[6]).toBe(Date.UTC(2026, 6, 15));
		expect(days[6].hours[0]).toBe(1);
	});
});
