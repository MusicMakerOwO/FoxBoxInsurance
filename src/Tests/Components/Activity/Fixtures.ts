/**
 * Shared fixtures for the activity + timezone suites - no tests of its own, and no `vi.mock`s (those
 * have to live in each test file to be hoisted).
 */

export const USER_ID = '900000000000000005';
export const GUILD_ID = '900000000000000006';

// 2026-07-15 12:00 UTC - daylight saving in the northern hemisphere, no transition anywhere near it
export const SUMMER = Date.UTC(2026, 6, 15, 12);
// 2026-01-15 12:00 UTC - standard time in the northern hemisphere
export const WINTER = Date.UTC(2026, 0, 15, 12);

export const SPANS = [
	{ span: 'week', days: 7 },
	{ span: 'month', days: 30 },
	{ span: 'year', days: 365 }
] as const;

/** The args GlobalHandler would hand the next handler for a rendered custom_id */
export function argsOf(customID: string): string[] {
	return customID.split('_').slice(1);
}
