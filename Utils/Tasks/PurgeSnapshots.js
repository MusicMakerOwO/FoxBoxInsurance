const Database = require("../Database");
const { FetchSnapshot } = require("../SnapshotUtils");
const Log = require("../Logs");

const MAX_SNAPSHOTS = 7;

module.exports = async function PurgeSnapshots() {

	const start = Date.now();

	const GuildsToPurge = Database.prepare(`
SELECT guild_id, COUNT(*) as snapshot_count
FROM Snapshots
GROUP BY guild_id
HAVING snapshot_count > ${MAX_SNAPSHOTS}
	`).all(); // { guild_id: string, snapshot_count: number }[]

	if (GuildsToPurge.length === 0) {
		Log.custom(`No guilds to purge snapshots for`, 0x7946ff);
		return;
	}

	let deleteCount = 0;

	for (const guild of GuildsToPurge) {
		const snapshotsToDelete = Math.max(0, guild.snapshot_count - MAX_SNAPSHOTS);
		if (snapshotsToDelete === 0) continue;

		deleteCount += snapshotsToDelete;

		const availableSnapshots = Database.prepare(`
			SELECT id
			FROM Snapshots
			WHERE guild_id = ?
			ORDER BY ID ASC
		`).pluck().all(guild.guild_id); // { id: number }[]
		const snapshotsToPurge = availableSnapshots.slice(0, snapshotsToDelete);
		if (snapshotsToPurge.length === 0) throw new Error(`No snapshots to purge for guild ${guild.guild_id}.`);

		// need to move the data forward
		const targetSnapshotID = availableSnapshots[snapshotsToDelete];

		const targetSnapshot = FetchSnapshot(targetSnapshotID); // walk the data forward to get the current state
		if (!targetSnapshot) throw new Error(`Target snapshot with ID ${targetSnapshotID} not found for guild ${guild.guild_id}.`);

		Database.transaction(() => {
			// It's some kind of frankenstein to move the data forward
			// Clear the data, recreate it with the current state, and finally delete the old snapshots
	
			Database.prepare(`
				DELETE FROM SnapshotRoles
				WHERE snapshot_id = ?
			`).run(targetSnapshotID);
			Database.prepare(`
				DELETE FROM SnapshotChannels
				WHERE snapshot_id = ?
			`).run(targetSnapshotID);
			Database.prepare(`
				DELETE FROM SnapshotPermissions
				WHERE snapshot_id = ?
			`).run(targetSnapshotID);
			Database.prepare(`
				DELETE FROM SnapshotBans
				WHERE snapshot_id = ?
			`).run(targetSnapshotID);

			for (const role of targetSnapshot.roles.values()) {
				Database.prepare(`
					INSERT INTO SnapshotRoles (snapshot_id, id, name, color, hoist, position, permissions, hash, deleted)
					VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
				`).run(targetSnapshotID, role.id, role.name, role.color, role.hoist, role.position, role.permissions, role.hash, 0);
			}
			for (const channel of targetSnapshot.channels.values()) {
				Database.prepare(`
					INSERT INTO SnapshotChannels (snapshot_id, id, type, name, position, topic, nsfw, parent_id, hash, deleted)
					VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
				`).run(targetSnapshotID, channel.id, channel.type, channel.name, channel.position, channel.topic, channel.nsfw, channel.parent_id, channel.hash, 0);
			}
			for (const permission of targetSnapshot.permissions.values()) {
				Database.prepare(`
					INSERT INTO SnapshotPermissions (snapshot_id, channel_id, role_id, allow, deny, hash, deleted)
					VALUES (?, ?, ?, ?, ?, ?, ?)
				`).run(targetSnapshotID, permission.channel_id, permission.role_id, permission.allow, permission.deny, permission.hash, 0);
			}
			for (const ban of targetSnapshot.bans.values()) {
				Database.prepare(`
					INSERT INTO SnapshotBans (snapshot_id, user_id, reason, hash, deleted)
					VALUES (?, ?, ?, ?, ?)
				`).run(targetSnapshotID, ban.user_id, ban.reason, ban.hash, 0);
			}

			// Now delete the old snapshots
			Database.prepare(`
				DELETE FROM Snapshots
				WHERE id IN (${snapshotsToPurge.map(() => '?').join(', ')})
			`).run(...snapshotsToPurge);
			Database.prepare(`
				DELETE FROM SnapshotRoles
				WHERE snapshot_id IN (${snapshotsToPurge.map(() => '?').join(', ')})
			`).run(...snapshotsToPurge);
			Database.prepare(`
				DELETE FROM SnapshotChannels
				WHERE snapshot_id IN (${snapshotsToPurge.map(() => '?').join(', ')})
			`).run(...snapshotsToPurge);
			Database.prepare(`
				DELETE FROM SnapshotPermissions
				WHERE snapshot_id IN (${snapshotsToPurge.map(() => '?').join(', ')})
			`).run(...snapshotsToPurge);
			Database.prepare(`
				DELETE FROM SnapshotBans
				WHERE snapshot_id IN (${snapshotsToPurge.map(() => '?').join(', ')})
			`).run(...snapshotsToPurge);
		})();
	}

	const end = Date.now();
	const duration = end - start;
	Log.custom(`Purged ${deleteCount} snapshots from ${GuildsToPurge.length} guilds : ${duration}ms`, 0x7946ff);
}