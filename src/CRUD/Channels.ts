import { SimpleChannel } from "../Typings/DatabaseTypes";
import {LRUCache} from "../Utils/DataStructures/LRUCache";
import {client} from "../Client";
import {GuildChannel} from "discord.js";
import {Database} from "../Database";

const cache = new LRUCache<SimpleChannel['id'], SimpleChannel>(100);

const INVALID_CHANNEL_IDS = new Set<GuildChannel['id']>();

export async function SaveChannel(channel: GuildChannel | SimpleChannel) {
	const connection = await Database.getConnection();

	if (channel instanceof GuildChannel) {
		// I hate it, yeah, but I don't know another way to get the column defaults at runtime :v
		await connection.query(`INSERT INTO Channels (guild_id, id, name, type) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE name = ?`, [channel.guildId, channel.id, channel.name, channel.type]);
		const saved = await connection.query(`SELECT * FROM Channels WHERE id = ?`, [channel.id]).then( x => x[0]) as SimpleChannel;
		cache.set(saved.id, saved);
		INVALID_CHANNEL_IDS.delete(channel.id);
	} else {
		await connection.query(`UPDATE Channels SET name = ?, block_exports = ?, last_purge = ? WHERE id = ?`, [channel.name, channel.block_exports, channel.last_purge, channel.id]);
		cache.set(channel.id, channel);
	}

	Database.releaseConnection(connection);
}

export async function GetChannel(id: string | bigint) {
	id = BigInt(id);
	if (cache.has(id)) return cache.get(id)!;

	const stringID = id.toString();
	if (INVALID_CHANNEL_IDS.has(stringID)) return null;

	if (client.channels.cache.has(stringID)) {
		const cached = client.channels.cache.get(stringID)!;
		if (!(cached instanceof GuildChannel)) throw new Error('Cannot fetch channels outside of guilds (ie. DMs or Group Chats)');
		await SaveChannel(cached as GuildChannel);
		return cache.get(id);
	}

	const dbChannel = await Database.query('SELECT * FROM Channels WHERE id = ?', [id]).then(x => x[0]) as SimpleChannel | null;
	if (dbChannel) {
		cache.set(dbChannel.id, dbChannel);
		return dbChannel;
	}

	const fetched = await client.channels.fetch(stringID).catch( () => null)
	if (!fetched) {
		INVALID_CHANNEL_IDS.add(stringID);
		return null;
	}

	if (!(fetched instanceof GuildChannel)) throw new Error('Cannot fetch channels outside of guilds (ie. DMs or Group Chats)');

	await SaveChannel(fetched);
	return cache.get(id);
}

/**
 * Removes the provided channel from cache if it exists, however the data will still exist in database.
 * If you intend to delete all the related data, use `DANGER_PurgeChannel()` instead.
 */
export async function DiscardChannel(id: string | bigint) {
	id = BigInt(id);
	cache.delete(id);
	INVALID_CHANNEL_IDS.delete(id.toString());
}

/**
 * Deletes ALL the associated data with the given channel.
 *
 * THIS CANNOT BE UNDONE!!!
 */
export async function DANGER_PurgeChannel(id: string | bigint) {
	id = BigInt(id);
	await Database.query('DELETE FROM Channels WHERE id = ?', [id]);
}