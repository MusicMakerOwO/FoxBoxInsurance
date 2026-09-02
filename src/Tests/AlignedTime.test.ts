import { describe, expect, it, vi, afterEach } from "vitest";
import { AlignTime, AlignedNow, AlignedUnix, AlignedWindow } from "../Utils/AlignedTime.js";
import { SECONDS } from "../Utils/Constants.js";

// 2026-08-31T13:37:42.500Z
const SAMPLE = Date.UTC(2026, 7, 31, 13, 37, 42, 500);

describe('AlignTimestamp', () => {
	it('floors to the previous boundary by default', () => {
		expect(AlignTime(SAMPLE, SECONDS.HOUR)).toBe(Date.UTC(2026, 7, 31, 13));
		expect(AlignTime(SAMPLE, SECONDS.DAY)).toBe(Date.UTC(2026, 7, 31));
	});

	it('ceils to the next boundary', () => {
		expect(AlignTime(SAMPLE, SECONDS.HOUR, 'ceil')).toBe(Date.UTC(2026, 7, 31, 14));
		expect(AlignTime(SAMPLE, SECONDS.DAY, 'ceil')).toBe(Date.UTC(2026, 8, 1));
	});

	it('leaves timestamps that are already aligned alone', () => {
		const aligned = Date.UTC(2026, 7, 31);
		expect(AlignTime(aligned, SECONDS.DAY, 'floor')).toBe(aligned);
		expect(AlignTime(aligned, SECONDS.DAY, 'ceil')).toBe(aligned);
	});

	it('handles sub hour intervals', () => {
		expect(AlignTime(SAMPLE, SECONDS.DAY / 4)).toBe(Date.UTC(2026, 7, 31, 12));
		expect(AlignTime(SAMPLE, SECONDS.MINUTE * 15)).toBe(Date.UTC(2026, 7, 31, 13, 30));
	});

	it('counts boundaries from an anchor when given one', () => {
		const anchor = Date.UTC(2026, 7, 31, 0, 10);
		expect(AlignTime(SAMPLE, SECONDS.HOUR, 'floor', anchor)).toBe(Date.UTC(2026, 7, 31, 13, 10));
	});

	it('rejects invalid input', () => {
		expect(() => AlignTime(NaN, SECONDS.HOUR)).toThrow(TypeError);
		expect(() => AlignTime(SAMPLE, 0)).toThrow(RangeError);
		expect(() => AlignTime(SAMPLE, -1)).toThrow(RangeError);
		expect(() => AlignTime(SAMPLE, Infinity)).toThrow(RangeError);
	});
});

describe('AlignedNow', () => {
	afterEach(() => vi.useRealTimers());

	it('aligns the current time', () => {
		vi.useFakeTimers();
		vi.setSystemTime(SAMPLE);

		expect(AlignedNow(SECONDS.DAY)).toBe(Date.UTC(2026, 7, 31));
		expect(AlignedNow(SECONDS.DAY, 'ceil')).toBe(Date.UTC(2026, 8, 1));
	});
});

describe('AlignedWindow', () => {
	afterEach(() => vi.useRealTimers());

	it('covers exactly count whole intervals, dropping the partial one', () => {
		vi.useFakeTimers();
		vi.setSystemTime(SAMPLE);

		const [start, end] = AlignedWindow(SECONDS.DAY, 7);
		expect(start).toBe(Date.UTC(2026, 7, 24));
		expect(end).toBe(Date.UTC(2026, 7, 31) - 1);
		expect(end + 1 - start).toBe(7 * SECONDS.DAY * 1000);
	});

	it('keeps the interval in progress with includePartial', () => {
		vi.useFakeTimers();
		vi.setSystemTime(SAMPLE);

		const [start, end] = AlignedWindow(SECONDS.DAY, 7, { includePartial: true });
		expect(start).toBe(Date.UTC(2026, 7, 25));
		expect(end).toBe(Date.UTC(2026, 8, 1) - 1);
	});

	it('rejects a non positive count', () => {
		expect(() => AlignedWindow(SECONDS.DAY, 0)).toThrow(RangeError);
		expect(() => AlignedWindow(SECONDS.DAY, 1.5)).toThrow(RangeError);
	});
});

describe('AlignedUnix', () => {
	it('returns whole seconds on a boundary', () => {
		expect(AlignedUnix(SAMPLE, SECONDS.HOUR)).toBe(Date.UTC(2026, 7, 31, 13) / 1000);
		expect(AlignedUnix(SAMPLE)).toBe(Date.UTC(2026, 7, 31, 13, 37) / 1000);
	});
});
