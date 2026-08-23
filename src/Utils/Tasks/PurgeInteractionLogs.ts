import { Database } from "../../Database.js";
import { SECONDS } from "../Constants.js";
import { Log } from "../Log.js";

export async function PurgeInteractionLogs(): Promise<void> {
	// any logs older than 60 days - created_at is stored in seconds, not milliseconds
	const expired = Math.floor((Date.now() - SECONDS.DAY * 60 * 1000) / 1000);

	const { affectedRows } = await Database.query(
		'DELETE FROM InteractionLogs WHERE created_at < ?', [expired]
	) as { affectedRows: bigint };

	Log('DELETE', `Purged ${affectedRows} expired interaction log(s)`);
}
