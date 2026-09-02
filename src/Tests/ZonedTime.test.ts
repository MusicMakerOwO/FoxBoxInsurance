import { describe, expect, it } from "vitest";
import { ZoneOffset, ZonedDate, ZonedDayStarts } from "../Utils/ZonedTime.js";
import { SECONDS } from "../Utils/Constants.js";

const HOUR = SECONDS.HOUR * 1000;
const DAY = SECONDS.DAY * 1000;

// US daylight saving in 2026: forward 2026-03-08, back 2026-11-01
const SUMMER = Date.UTC(2026, 6, 15, 12);
const WINTER = Date.UTC(2026, 0, 15, 12);

describe('ZoneOffset', () => {
	it('follows daylight saving within the same zone', () => {
		expect(ZoneOffset('America/Chicago', SUMMER)).toBe(-5 * HOUR);
		expect(ZoneOffset('America/Chicago', WINTER)).toBe(-6 * HOUR);
	});

	it('handles zones ahead of UTC', () => {
		expect(ZoneOffset('Asia/Tokyo', SUMMER)).toBe(9 * HOUR);
	});

	it('handles half hour zones', () => {
		expect(ZoneOffset('Asia/Kolkata', SUMMER)).toBe(5.5 * HOUR);
		expect(ZoneOffset('Australia/Adelaide', SUMMER)).toBe(9.5 * HOUR);
	});

	it('is zero for UTC', () => {
		expect(ZoneOffset('Etc/UTC', SUMMER)).toBe(0);
		expect(ZoneOffset('Etc/UTC', WINTER)).toBe(0);
	});

	it('resolves midnight without rolling into the next day', () => {
		expect(ZoneOffset('America/Chicago', Date.UTC(2026, 6, 15, 5))).toBe(-5 * HOUR);
	});
});

describe('ZonedDate', () => {
	it('reads back as local wall clock through getUTC*', () => {
		const date = ZonedDate('America/Chicago', SUMMER);

		expect(date.getUTCFullYear()).toBe(2026);
		expect(date.getUTCMonth()).toBe(6);
		expect(date.getUTCDate()).toBe(15);
		expect(date.getUTCHours()).toBe(7); // 12:00 UTC is 07:00 CDT
	});

	// The case the old getUTCDate() labelling got wrong: local midnight in a zone ahead of UTC
	// falls on the *previous* UTC day, so labels were a day early for anyone east of Greenwich.
	it('labels the local day for zones ahead of UTC', () => {
		const tokyoMidnight = Date.UTC(2026, 8, 1, 15); // 2026-09-02 00:00 JST

		expect(new Date(tokyoMidnight).getUTCDate()).toBe(1);
		expect(ZonedDate('Asia/Tokyo', tokyoMidnight).getUTCDate()).toBe(2);
	});
});

describe('ZonedDayStarts', () => {
	it('returns count days, oldest first, ending with today', () => {
		const starts = ZonedDayStarts('America/Chicago', SUMMER, 7);

		expect(starts).toHaveLength(7);
		expect(starts[6]).toBe(Date.UTC(2026, 6, 15, 5)); // 2026-07-15 00:00 CDT
		expect([...starts].sort((a, b) => a - b)).toEqual(starts);
	});

	it('lands every entry on local midnight', () => {
		for (const start of ZonedDayStarts('America/Chicago', SUMMER, 7)) {
			expect(ZonedDate('America/Chicago', start).getUTCHours()).toBe(0);
		}
	});

	it('keeps 24 hour gaps when no transition is in range', () => {
		const starts = ZonedDayStarts('America/Chicago', SUMMER, 7);
		const gaps = starts.slice(1).map((start, i) => start - starts[i]);

		expect(gaps).toEqual(new Array(6).fill(DAY));
	});

	// This is what a single fixed offset resolved once per render cannot do
	it('produces a 23 hour day across spring forward', () => {
		const starts = ZonedDayStarts('America/Chicago', Date.UTC(2026, 2, 10, 12), 5);
		const gaps = starts.slice(1).map((start, i) => start - starts[i]);

		expect(gaps).toEqual([DAY, DAY, DAY - HOUR, DAY]);
	});

	it('produces a 25 hour day across fall back', () => {
		const starts = ZonedDayStarts('America/Chicago', Date.UTC(2026, 10, 3, 12), 5);
		const gaps = starts.slice(1).map((start, i) => start - starts[i]);

		expect(gaps).toEqual([DAY, DAY, DAY + HOUR, DAY]);
	});

	it('stays on local midnight either side of a transition', () => {
		for (const start of ZonedDayStarts('America/Chicago', Date.UTC(2026, 2, 10, 12), 5)) {
			expect(ZonedDate('America/Chicago', start).getUTCHours()).toBe(0);
		}
	});

	it('walks back across a month boundary', () => {
		const starts = ZonedDayStarts('America/Chicago', Date.UTC(2026, 6, 2, 12), 4);

		expect(ZonedDate('America/Chicago', starts[0]).getUTCMonth()).toBe(5);
		expect(ZonedDate('America/Chicago', starts[0]).getUTCDate()).toBe(29);
	});

	it('rejects a non positive count', () => {
		expect(() => ZonedDayStarts('Etc/UTC', SUMMER, 0)).toThrow(RangeError);
		expect(() => ZonedDayStarts('Etc/UTC', SUMMER, 1.5)).toThrow(RangeError);
	});
});
