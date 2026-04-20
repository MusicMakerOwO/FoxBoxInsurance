import { GUILD_FEATURES, SimpleGuild } from "../Typings/DatabaseTypes";
import {LRUCache} from "../Utils/DataStructures/LRUCache";
import {client} from "../Client";
import {Guild} from "discord.js";
import {Database} from "../Database";

const cache = new LRUCache<SimpleGuild['id'], SimpleGuild>(100);

const INVALID_GUILD_IDS = new Set<Guild['id']>();

export async function SaveGuild(guild: Guild | SimpleGuild) {
	const connection = await Database.getConnection();

	if (guild instanceof Guild) {
		// I hate it, yeah, but I don't know another way to get the column defaults at runtime :v
		await connection.query(`INSERT INTO Guilds (id, name, features) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE name = VALUES(name)`, [guild.id, guild.name, Object.values(GUILD_FEATURES).reduce((a, b) => a | b, 0)]);
		const saved = await connection.query(`SELECT * FROM Guilds WHERE id = ?`, [guild.id]).then( x => x[0]) as SimpleGuild;
		cache.set(saved.id, saved);
		INVALID_GUILD_IDS.delete(guild.id);
	} else {
		await connection.query(`UPDATE Guilds SET name = ?, features = ?, last_restore = ? WHERE id = ?`, [guild.name, guild.features, guild.last_restore, guild.id]);
		cache.set(guild.id, guild);
	}

	Database.releaseConnection(connection);
}

export async function GetGuild(id: string | bigint) {
	id = BigInt(id);
	if (cache.has(id)) return cache.get(id)!;

	const stringID = id.toString();
	if (INVALID_GUILD_IDS.has(stringID)) return null;

	if (client.guilds.cache.has(stringID)) {
		await SaveGuild(client.guilds.cache.get(stringID)!);
		return cache.get(id);
	}

	const dbGuild = await Database.query('SELECT * FROM Guilds WHERE id = ?', [id]).then(x => x[0]) as SimpleGuild | null;
	if (dbGuild) {
		cache.set(dbGuild.id, dbGuild);
		return dbGuild;
	}

	const fetched = await client.guilds.fetch(stringID).catch( () => null)
	if (!fetched) {
		INVALID_GUILD_IDS.add(stringID);
		return null;
	}

	await SaveGuild(fetched);
	return cache.get(id);
}

/**
 * Removes the provided guild from cache if it exists, however the data will still exist in database.
 * If you intend to delete all the related data, use `DANGER_PurgeGuild()` instead.
 */
export async function DiscardGuild(id: string | bigint) {
	cache.delete(BigInt(id));
	INVALID_GUILD_IDS.delete(String(id));
}

/**
 * Deletes ALL the associated data with the given guild.
 *
 * THIS CANNOT BE UNDONE!!!
 */
export async function DANGER_PurgeGuild(id: string | bigint) {
	await Database.query('DELETE FROM Guilds WHERE id = ?', [ BigInt(id) ]);
}