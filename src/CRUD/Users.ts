import {LRUCache} from "../Utils/DataStructures/LRUCache";
import {client} from "../Client";
import {Database} from "../Database";
import {SimpleUser} from "../Typings/DatabaseTypes";
import {User} from "discord.js";

const cache = new LRUCache<SimpleUser['id'], SimpleUser>(1000);

const INVALID_USER_IDS = new Set<User['id']>();

export async function SaveUser(user: User | SimpleUser) {
	const connection = await Database.getConnection();

	if (user instanceof User) {
		// I hate it, yeah, but I don't know another way to get the column defaults at runtime :v
		await connection.query(`INSERT INTO Users (id, username, bot) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE username = ?`, [user.id, user.username, user.bot, user.username]);
		const saved = await connection.query(`SELECT * FROM Users WHERE id = ?`, [user.id]).then( x => x[0]) as SimpleUser;
		cache.set(saved.id, saved);
		INVALID_USER_IDS.delete(user.id);
	} else {
		await connection.query(`UPDATE Users SET username = ?, terms_version_accepted = ?, wrapped_key = ? WHERE id = ?`, [user.username, user.terms_version_accepted, user.wrapped_key, user.id]);
		cache.set(user.id, user);
	}

	Database.releaseConnection(connection);
}

export async function GetUser(id: string | bigint) {
	id = BigInt(id);
	if (cache.has(id)) return cache.get(id)!;

	const stringID = id.toString();
	if (INVALID_USER_IDS.has(stringID)) return null;

	if (client.users.cache.has(stringID)) {
		const cached = client.users.cache.get(stringID)!;
		await SaveUser(cached);
		return cache.get(id);
	}

	const dbUser = await Database.query('SELECT * FROM Users WHERE id = ?', [id]).then(x => x[0]) as SimpleUser | null;
	if (dbUser) {
		cache.set(dbUser.id, dbUser);
		return dbUser;
	}

	const fetched = await client.users.fetch(stringID).catch( () => null)
	if (!fetched) {
		INVALID_USER_IDS.add(stringID);
		return null;
	}

	await SaveUser(fetched);
	return cache.get(id);
}

/**
 * Removes the provided user from cache if it exists, however the data will still exist in database.
 * If you intend to delete all the related data, use `DANGER_PurgeUser()` instead.
 */
export async function DiscardUser(id: string | bigint) {
	id = BigInt(id);
	cache.delete(id);
	INVALID_USER_IDS.delete(id.toString());
}

/**
 * Deletes ALL the associated data with the given user.
 *
 * THIS CANNOT BE UNDONE!!!
 */
export async function DANGER_PurgeUser(id: string | bigint) {
	id = BigInt(id);
	await Database.query('DELETE FROM Users WHERE id = ?', [id]);
}