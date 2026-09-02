import { describe, expect, test } from 'vitest';

// The bot pins itself to UTC in Utils/ProcessTimezone.ts, and vitest.config.ts does the same for
// tests. These lock in *why*: the MariaDB connector decodes DATETIME columns with `new Date(str)`
// and serialises Date parameters out of local getters, so a non-UTC process silently shifts every
// DATETIME by its local offset in both directions. Snapshots.created_at is the column that made
// this visible - it read back five hours in the future from a UTC-5 machine.
describe('process timezone', () => {
	test('the process runs on UTC', () => {
		expect(new Date().getTimezoneOffset()).toBe(0);
	});

	// How the connector decodes a DATETIME column (lib/io/packet.js -> readDateTime)
	test('a DATETIME string decodes to the instant the server stored', () => {
		expect(new Date('2026-09-02 19:10:36.000').toISOString()).toBe('2026-09-02T19:10:36.000Z');
	});

	// How the connector serialises a Date parameter (lib/io/packet-output-stream.js -> writeBinaryDate)
	test('a Date parameter serialises back to the same wall clock', () => {
		const date = new Date('2026-09-02T19:10:36.000Z');

		expect([
			date.getFullYear(), date.getMonth() + 1, date.getDate(),
			date.getHours(), date.getMinutes(), date.getSeconds()
		]).toEqual([2026, 9, 2, 19, 10, 36]);
	});
});
