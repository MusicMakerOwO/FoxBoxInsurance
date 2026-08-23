import {LRUCache} from "../Utils/DataStructures/LRUCache.js";
import {client} from "../Client.js";
import {Database} from "../Database.js";
import {SimpleUser} from "../Typings/DatabaseTypes.js";
import {User} from "discord.js";
import { SECONDS } from "../Utils/Constants.js";

const cache = new LRUCache<SimpleUser['id'], SimpleUser>(1000);

const INVALID_USER_IDS = new Set<User['id']>();

export async function SaveUser(user: User | SimpleUser): Promise<void> {
	const connection = await Database.getConnection();

	try {
		if (user instanceof User) {
			// I hate it, yeah, but I don't know another way to get the column defaults at runtime :v
			await connection.query(`INSERT INTO Users (id, username, bot) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE username = VALUES(username)`, [user.id, user.username, user.bot]);
			const saved = await connection.query(`SELECT * FROM Users WHERE id = ?`, [user.id]).then( x => x[0]) as SimpleUser;
			cache.set(saved.id, saved);
			INVALID_USER_IDS.delete(user.id);
		} else {
			await connection.query(`UPDATE Users SET username = ?, terms_version_accepted = ?, wrapped_key = ?, opt_out_collection = ? WHERE id = ?`, [user.username, user.terms_version_accepted, user.wrapped_key, user.opt_out_collection, user.id]);
			cache.set(user.id, user);
		}
	} finally {
		Database.releaseConnection(connection);
	}
}

export async function GetUser(id: string | bigint): Promise<SimpleUser | null> {
	return (await GetUserBulk([id])).get(BigInt(id)) ?? null;
}

/** Resolves many users, batching the DB lookup into a single query for whatever isn't already cached or in Discord's own cache. */
export async function GetUserBulk(ids: (string | bigint)[]): Promise<Map<SimpleUser['id'], SimpleUser | null >> {
	const result = new Map<SimpleUser['id'], SimpleUser | null>();
	const unresolved = new Set<bigint>();

	for (const rawID of new Set(ids.map(x => BigInt(x)))) {
		if (cache.has(rawID)) {
			result.set(rawID, cache.get(rawID)!);
			continue;
		}
		if (INVALID_USER_IDS.has(rawID.toString())) {
			result.set(rawID, null);
			continue;
		}
		unresolved.add(rawID);
	}

	if (unresolved.size === 0) return result;

	const stillUnresolved = new Set<bigint>();
	for (const id of unresolved) {
		const stringID = id.toString();
		if (client.users.cache.has(stringID)) {
			await SaveUser(client.users.cache.get(stringID)!);
			result.set(id, cache.get(id));
		} else {
			stillUnresolved.add(id);
		}
	}

	if (stillUnresolved.size > 0) {
		const idArray = [... stillUnresolved];
		const dbUsers = await Database.query(
			`SELECT * FROM Users WHERE id IN (${'?,'.repeat(idArray.length - 1)}?)`,
			idArray
		) as SimpleUser[];

		for (const user of dbUsers) {
			cache.set(user.id, user);
			stillUnresolved.delete(user.id);
			result.set(user.id, user);
		}
	}

	if (stillUnresolved.size > 0) {
		await Promise.all([... stillUnresolved].map(async id => {
			const stringID = id.toString();
			const fetched = await client.users.fetch(stringID).catch( () => null);
			if (!fetched) {
				INVALID_USER_IDS.add(stringID);
				setTimeout( () => INVALID_USER_IDS.delete(stringID),  SECONDS.MINUTE * 10 * 1000 ).unref();
				result.set(id, null);
				return;
			}
			await SaveUser(fetched);
			result.set(id, cache.get(id));
		}));
	}

	return result;
}

/**
 * Removes the provided user from cache if it exists, however the data will still exist in database.
 * If you intend to delete all the related data, use `DANGER_PurgeUser()` instead.
 */
export async function DiscardUser(id: string | bigint): Promise<void> {
	id = BigInt(id);
	cache.delete(id);
	INVALID_USER_IDS.delete(id.toString());
}

/**
 * Deletes ALL the associated data with the given user.
 *
 * THIS CANNOT BE UNDONE!!!
 */
export async function DANGER_PurgeUser(id: string | bigint): Promise<void> {
	id = BigInt(id);
	await Database.query('DELETE FROM Users WHERE id = ?', [id]);
}