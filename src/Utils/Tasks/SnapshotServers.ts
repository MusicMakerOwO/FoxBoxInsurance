import {Database} from "../../Database.js";
import {client} from "../../Client.js";
import {Log} from "../Log.js";
import {CreateSnapshot} from "../../CRUD/Snapshots.js";
import {SNAPSHOT_TYPE} from "../Constants.js";
import {PurgeSnapshots} from "./PurgeSnapshots.js";
import {GetGuild} from "../../CRUD/Guilds.js";
import {GUILD_FEATURES} from "../../Typings/DatabaseTypes.js";

export async function SnapshotServers(): Promise<void> {
	const currentHour = new Date().getUTCHours();

	const snapshotQueue = [];

	const connection = await Database.getConnection();

	for (const guild of client.guilds.cache.values()) {
		if (BigInt(guild.id) % 24n !== BigInt(currentHour)) continue;
		const savedGuild = (await GetGuild(guild.id))!;
		if (!process.env.DEV_MODE && (savedGuild.features & GUILD_FEATURES.AUTOMATIC_SNAPSHOTS) === 0) {
			if (process.env.DEV_MODE) Log('DEBUG', `Skipping ${guild.name} (${guild.id}) - Snapshots disabled`);
			continue;
		}
		snapshotQueue.push(guild);
	}

	Database.releaseConnection(connection);

	if (snapshotQueue.length === 0) return;

	if (process.env.DEV_MODE) console.log(`Backing up ${snapshotQueue.length} servers : ${snapshotQueue.map(g => g.id).join(', ')}`);

	for (const guild of snapshotQueue) {
		try {
			const snapshotID = await CreateSnapshot(guild, SNAPSHOT_TYPE.AUTOMATIC)
			if (!snapshotID) {
				Log('ERROR', `Failed to create snapshot for ${guild.name}: No snapshot returned`);
			}
		} catch (error) {
			Log('ERROR', `Cannot snapshot guild: ${guild.id}`);
			Log('ERROR', error);
		}
	}

	void PurgeSnapshots();
}