const client = require('../../client.js');
const { SNAPSHOT_TYPE } = require('../Constants.js');
const { CreateSnapshot } = require('../SnapshotUtils.js');
const Log = require('../Logs.js');
const Database = require('../Database.js');
const PurgeSnapshots = require('./PurgeSnapshots.js');

module.exports = async function SnapshotServers() {
	const currentHour = new Date().getUTCHours();

	const snapshotQueue = [];

	for (const guild of client.guilds.cache.values()) {
		if (BigInt(guild.id) % 24n !== BigInt(currentHour)) continue;
		const enabled = Database.prepare('SELECT snapshots_enabled FROM Guilds WHERE id = ?').pluck().get(guild.id);
		if (!enabled || enabled.snapshots_enabled === 0) {
			Log.custom(`Skipping ${guild.name} (${guild.id}) - Snapshots disabled`, 0x7946ff);
			continue;
		}
		snapshotQueue.push(guild);
	}

	if (snapshotQueue.length === 0) {
		Log.custom('No servers to snapshot this hour', 0x7946ff);
		return;
	}

	console.log(`Backing up ${snapshotQueue.length} servers`);

	for (const guild of snapshotQueue) {
		const snapshotID = await CreateSnapshot(guild, SNAPSHOT_TYPE.AUTOMATIC);
		if (!snapshotID) {
			Log.warn(`Failed to create snapshot for ${guild.name}: No snapshot returned`);
			continue;
		}
	}

	PurgeSnapshots();

}