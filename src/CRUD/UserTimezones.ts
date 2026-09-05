import { SimpleUserTimezone } from "../Typings/DatabaseTypes.js";
import { LRUCache } from "../Utils/DataStructures/LRUCache.js";
import { Database } from "../Database.js";
import { DEFAULT_TIMEZONE } from "../Utils/Timezones.js";

const cache = new LRUCache<SimpleUserTimezone['user_id'], string>(1_000);

/**
 * Stores an IANA zone against a user.
 *
 * `timezone` must be a zone, not something a user typed - run input through `ResolveTimezone` in
 * `Utils/Timezones.ts` first and only persist a `resolved` outcome.
 */
export async function SetTimezone(id: SimpleUserTimezone['user_id'] | string, timezone: string): Promise<void> {
	id = BigInt(id);
	await Database.query(
		`INSERT INTO UserTimezones (user_id, timezone) VALUES (?, ?) ON DUPLICATE KEY UPDATE timezone = VALUES(timezone)`,
		[id, timezone]
	);
	cache.set(id, timezone);
}

/** The user's IANA zone, or `Etc/UTC` if they have never set one. */
export async function GetTimezone(id: SimpleUserTimezone['user_id'] | string): Promise<string> {
	id = BigInt(id);
	if (cache.has(id)) return cache.get(id)!;

	const row = await Database.query(`SELECT * FROM UserTimezones WHERE user_id = ?`, [id]).then(x => x[0]) as SimpleUserTimezone | null;
	if (!row) return DEFAULT_TIMEZONE;

	cache.set(id, row.timezone);
	return row.timezone;
}