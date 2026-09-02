import { SimpleUserTimezone } from "../Typings/DatabaseTypes.js";
import { LRUCache } from "../Utils/DataStructures/LRUCache.js";
import { Database } from "../Database.js";
import { ObjectValues } from "../Typings/HelperTypes.js";

/**
 * Keys are disambiguated where an abbreviation is shared by multiple zones (e.g. CST, IST) -
 * these are what select menu values / ConvertTimezone input should use, not the raw abbreviation.
 */
export const TIMEZONE_ZONES = {
	UTC: 'Etc/UTC',
	GMT: 'Etc/UTC',

	EST: 'America/New_York',
	EDT: 'America/New_York',
	CST: 'America/Chicago',
	CDT: 'America/Chicago',
	MST: 'America/Denver',
	MDT: 'America/Denver',
	PST: 'America/Los_Angeles',
	PDT: 'America/Los_Angeles',
	AKST: 'America/Anchorage',
	AKDT: 'America/Anchorage',
	HST: 'Pacific/Honolulu',
	AST: 'America/Halifax',
	ADT: 'America/Halifax',
	NST: 'America/St_Johns',
	NDT: 'America/St_Johns',

	BST: 'Europe/London',
	CET: 'Europe/Paris',
	CEST: 'Europe/Paris',
	EET: 'Europe/Helsinki',
	EEST: 'Europe/Helsinki',
	WET: 'Europe/Lisbon',
	WEST: 'Europe/Lisbon',
	MSK: 'Europe/Moscow',

	IST_IN: 'Asia/Kolkata',
	IST_IE: 'Europe/Dublin',
	IST_IL: 'Asia/Jerusalem',
	JST: 'Asia/Tokyo',
	KST: 'Asia/Seoul',
	CST_CN: 'Asia/Shanghai',
	SGT: 'Asia/Singapore',
	HKT: 'Asia/Hong_Kong',
	AEST: 'Australia/Sydney',
	AEDT: 'Australia/Sydney',
	ACST: 'Australia/Adelaide',
	ACDT: 'Australia/Adelaide',
	AWST: 'Australia/Perth',
	NZST: 'Pacific/Auckland',
	NZDT: 'Pacific/Auckland',

	BRT: 'America/Sao_Paulo',
	ART: 'America/Argentina/Buenos_Aires',
} as const;

const cache = new LRUCache<SimpleUserTimezone['id'], ObjectValues<typeof TIMEZONE_ZONES>>(1_000);

/** Resolves a timezone (EST, CST, GMT) to its IANA zone, or UTC if unrecognized. See `TIMEZONE_ZONES` for the full list. */
export function ConvertTimezone(zone: string): ObjectValues<typeof TIMEZONE_ZONES> {
	return TIMEZONE_ZONES[zone as keyof typeof TIMEZONE_ZONES] ?? TIMEZONE_ZONES.UTC;
}

/** Converts an IANA zone back to a user-friendly timezone abbreviation (e.g., 'America/New_York' → 'EST'). */
export function IANAToTimezone(ianaZone: string): string {
	for (const [tz, zone] of Object.entries(TIMEZONE_ZONES)) {
		if (zone === ianaZone) return tz;
	}
	return 'UTC';
}

export async function SetTimezone(id: SimpleUserTimezone['id'] | string, timezone: ObjectValues<typeof TIMEZONE_ZONES>): Promise<void> {
	id = BigInt(id);
	await Database.query(
		`INSERT INTO UserTimezones (user_id, timezone) VALUES (?, ?) ON DUPLICATE KEY UPDATE timezone = VALUES(timezone)`,
		[id, timezone]
	);
	cache.set(id, timezone);
}

export async function GetTimezone(id: SimpleUserTimezone['id'] | string): Promise<ObjectValues<typeof TIMEZONE_ZONES>> {
	id = BigInt(id);
	if (cache.has(id)) return cache.get(id)!;

	const row = await Database.query(`SELECT * FROM UserTimezones WHERE user_id = ?`, [id]).then(x => x[0]) as SimpleUserTimezone | null;
	if (!row) return TIMEZONE_ZONES.UTC;

	cache.set(row.id, row.timezone);
	return row.timezone;
}