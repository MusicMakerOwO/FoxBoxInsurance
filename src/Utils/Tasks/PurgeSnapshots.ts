import {Database} from "../../Database";
import {DeleteSnapshot, MaxSnapshotsForGuild} from "../../CRUD/Snapshots";
import {Log} from "../Log";

export async function PurgeSnapshots() {

	const start = Date.now();

	const GuildSnapshots = await Database.query(`
		SELECT guild_id, COUNT(*) as snapshot_count
		FROM Snapshots
		GROUP BY guild_id
	`, []) as { guild_id: bigint, snapshot_count: bigint }[];

	let deleteCount = 0;
	let purgedGuilds = 0;

	const connection = await Database.getConnection();

	for (const { guild_id, snapshot_count } of GuildSnapshots) {
		const maxSnapshots = await MaxSnapshotsForGuild(guild_id);
		if (snapshot_count <= maxSnapshots) continue;

		purgedGuilds++;

		const availableSnapshots = await connection.query(`
			SELECT id, pinned
			FROM Snapshots
			WHERE guild_id = ?
			ORDER BY pinned DESC, id DESC
		`, [guild_id]);

		if (availableSnapshots[ availableSnapshots.length - 1 ].pinned) {
			// every single snapshot is pinned, so we can't delete any
			continue;
		}

		for (let i = availableSnapshots.length - 1; i >= maxSnapshots; i--) {
			const snapshot = availableSnapshots[i]
			if (snapshot.pinned) {
				// we can't delete pinned snapshots
				continue;
			}

			deleteCount++;

			await DeleteSnapshot(snapshot.id);
			if (process.env.DEV_MODE) Log('DEBUG', `Deleted snapshot ${snapshot.id} for guild ${guild_id}`);
		}
	}

	Database.releaseConnection(connection);

	const end = Date.now();
	const duration = end - start;
	if (process.env.DEV_MODE) Log('DEBUG', `Purged ${deleteCount} snapshots from ${purgedGuilds} guilds in ${duration}ms`);
}