const Database = require("../Database");
const { FetchSnapshot, MaxSnapshots, isSnapshotDeletable, DeleteSnapshot } = require("../SnapshotUtils");
const Log = require("../Logs");

module.exports = async function PurgeSnapshots() {

	const start = Date.now();

	const GuildSnapshots = Database.prepare(`
SELECT guild_id, COUNT(*) as snapshot_count
FROM Snapshots
GROUP BY guild_id
	`).all(); // { guild_id: string, snapshot_count: number }[]

	let deleteCount = 0;
	let purgedGuilds = 0;

	for (const { guild_id, snapshot_count } of GuildSnapshots) {
		const maxSnapshots = MaxSnapshots(guild_id);
		if (snapshot_count <= maxSnapshots) continue;

		purgedGuilds++;

		const availableSnapshots = Database.prepare(`
			SELECT id, pinned
			FROM Snapshots
			WHERE guild_id = ?
			ORDER BY pinned DESC, id DESC
		`).all(guild_id); // number[]

		if (availableSnapshots[ availableSnapshots.length - 1].pinned) {
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

			DeleteSnapshot(snapshot.id);
			Log.custom(`Deleted snapshot ${snapshot.id} for guild ${guild_id}`, 0x7946ff);
		}
	}

	const end = Date.now();
	const duration = end - start;
	Log.custom(`Purged ${deleteCount} snapshots from ${purgedGuilds} guilds in ${duration}ms`, 0x7946ff);
}