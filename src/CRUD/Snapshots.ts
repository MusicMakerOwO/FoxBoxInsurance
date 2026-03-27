import { Database } from "../Database";
import { DIFF_CHANGE_TYPE, SNAPSHOT_TYPE } from "../Utils/Constants";
import { AnonymousGuild, Guild } from "discord.js";
import { Log } from "../Utils/Log";
import { LRUCache } from "../Utils/DataStructures/LRUCache";
import {
	SimpleGuild,
	SnapshotBan,
	SnapshotChannel,
	SnapshotMetadata,
	SnapshotRole
} from "../Typings/DatabaseTypes";
import { ObjectValues } from "../Typings/HelperTypes";
import { PoolConnection } from "mariadb";
import { CreateSnapshotDiff } from "../Utils/Snapshots/GuildDiff";
import { BuildSnapshotComparison } from "../Utils/Snapshots/BuildSnapshotComparison";

function Omit<T extends object, K extends keyof T>(data: T, props: K[]): Omit<T, K> {
	const result = { ...data };
	for (const key of props) {
		delete result[key];
	}
	return result;
}

export type Snapshot = SnapshotMetadata & {
	channels: Map<SnapshotChannel['id'], SnapshotChannel>;
	roles: Map<SnapshotRole['id'], SnapshotRole>;
	bans: Map<SnapshotBan['id'], SnapshotBan>;
}

/** Only used in JSON exports and internal caches */
export type JSONSnapshot = {
	id: string,
	version: number,
	type: typeof SNAPSHOT_TYPE.IMPORT,
	channels: Omit<SnapshotChannel, 'snapshot_id' | 'deleted'>[],
	roles: Omit<SnapshotRole, 'snapshot_id' | 'deleted'>[],
	bans: Omit<SnapshotBan, 'snapshot_id' | 'deleted'>[],
}

const cache = new LRUCache<Snapshot['id'], Snapshot>(100);

export async function ListSnapshotsForGuild(guildID: SimpleGuild['id'] | Guild['id']): Promise<SnapshotMetadata[]> {
	return await Database.query(`
        SELECT *
        FROM Snapshots
        WHERE guild_id = ?
	`, [BigInt(guildID)]) as SnapshotMetadata[];
}

export async function GetSnapshot(snapshot_id: Snapshot['id']) {
	if (cache.has(snapshot_id)) return cache.get(snapshot_id)!;

	const guildID = await ResolveGuildFromSnapshotID(snapshot_id).catch(() => 0n); // 0 for unknown guild

	const availableSnapshots = await Database.query(`
        SELECT id
        FROM Snapshots
        WHERE guild_id = ?
        ORDER BY id
	`, [guildID]).then((rows: { id: SnapshotMetadata['id'] }[]) => rows.map(row => row?.id));
	if (!availableSnapshots.includes(snapshot_id)) return null;

	const roles = new Map<SnapshotRole['id'], SnapshotRole>();
	const channels = new Map<SnapshotChannel['id'], SnapshotChannel>();
	const bans = new Map<SnapshotBan['id'], SnapshotBan>();

	const connection = await Database.getConnection();

	for (const snapshotID of availableSnapshots) {
		if (snapshotID > snapshot_id) break; // done reading snapshot data

		const snapshotRoles = await connection.query(`
            SELECT *
            FROM SnapshotRoles
            WHERE snapshot_id = ?
		`, [snapshotID]) as SnapshotRole[];
		for (const role of snapshotRoles) {
			if (role.deleted) {
				roles.delete(role.id);
			} else {
				roles.set(role.id, role);
			}
		}

		const snapshotChannels = await connection.query(`
            SELECT *
            FROM SnapshotChannels
            WHERE snapshot_id = ?
		`, [snapshotID]) as SnapshotChannel[];
		for (const channel of snapshotChannels) {
			if (channel.deleted) {
				channels.delete(channel.id);
			} else {
				channels.set(channel.id, channel);
			}
		}

		const snapshotBans = await connection.query(`
            SELECT *
            FROM SnapshotBans
            WHERE snapshot_id = ?
		`, [snapshotID]) as SnapshotBan[];
		for (const ban of snapshotBans) {
			if (ban.deleted) {
				bans.delete(ban.id);
			} else {
				bans.set(ban.id, ban);
			}
		}
	}

	const snapshotMetadata = await connection.query(`
        SELECT *
        FROM Snapshots
        WHERE id = ?
	`, [snapshot_id]).then(rows => rows[0]) as SnapshotMetadata;

	Database.releaseConnection(connection);

	const result = {
		... snapshotMetadata,
		channels   : channels,
		roles      : roles,
		bans       : bans
	}

	if (cache) cache.set(snapshot_id, result); // cache for 1 hour
	return result;
}

export async function CreateSnapshot(guild: AnonymousGuild, type: ObjectValues<typeof SNAPSHOT_TYPE> = SNAPSHOT_TYPE.AUTOMATIC) {
	if (!(guild instanceof Guild)) throw new Error('Expected argument to be a Guild instance');

	const availableSnapshots = await ListSnapshotsForGuild(guild.id);
	// find the largest snapshot ID
	const latestSnapshotID = availableSnapshots.reduce((latestID, snapshot) => Math.max(latestID, snapshot.id), -1);

	const lastSnapshot = await GetSnapshot(latestSnapshotID);

	const guildData = await BuildSnapshotComparison(guild);
	const snapshotData = await BuildSnapshotComparison(lastSnapshot);
	const serverDiff = CreateSnapshotDiff(snapshotData, guildData);

	const connection = await Database.getConnection();
	await connection.query('START TRANSACTION');

	await connection.query(`
        INSERT INTO Snapshots (guild_id, type)
        VALUES (?, ?)
	`, [guild.id, type]);

	const snapshotID = await connection.query('SELECT MAX(id) as id FROM Snapshots WHERE guild_id = ?', [guild.id]).then(rows => rows[0]?.id) as SnapshotMetadata['id'] | null;
	if (!snapshotID) {
		await connection.query(`ROLLBACK`);
		Database.releaseConnection(connection);
		throw new Error('Snapshot not found after insertion - Is this within a transaction?');
	}

	try {
		const promiseQueue: Promise<unknown>[] = [];

		if (serverDiff.roles.size > 0) promiseQueue.push(
			connection.batch(`
                INSERT INTO SnapshotRoles (
                                           snapshot_id,
                                           id, name, color, hoist,
                                           position, permissions, managed_by,
                                           deleted
				) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
			`, Array.from(serverDiff.roles.values()).map(role => [
				snapshotID,
				role.id, role.name, role.color, role.hoist,
				role.position, role.permissions, role.managed_by,
				role.change_type === DIFF_CHANGE_TYPE.DELETE ? 1 : 0
			]))
		);

		if (serverDiff.channels.size > 0) promiseQueue.push(
			connection.batch(`
                INSERT INTO SnapshotChannels (
					  snapshot_id,
					  id, type, name, position,
					  topic, nsfw, parent_id, permission_overwrites,
					  deleted
				) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
			`, Array.from(serverDiff.channels.values()).map(channel => [
				snapshotID,
				channel.id, channel.type, channel.name, channel.position,
				channel.topic, channel.nsfw, channel.parent_id, channel.permission_overwrites,
				channel.change_type === DIFF_CHANGE_TYPE.DELETE ? 1 : 0
			]))
		);

		if (serverDiff.bans.size > 0) promiseQueue.push(
			connection.batch(`
                INSERT INTO SnapshotBans (
					  snapshot_id,
					  id, reason,
					  deleted
				) VALUES (?, ?, ?, ?)
			`, Array.from(serverDiff.bans.values()).map(ban => [
				snapshotID,
				ban.id, ban.reason,
				ban.change_type === DIFF_CHANGE_TYPE.DELETE ? 1 : 0
			]))
		);

		await Promise.all(promiseQueue);

		await connection.query('COMMIT');

		if (process.env.DEV_MODE) Log('TRACE', `Snapshot #${snapshotID} created for ${guild.name} (${guild.id})`);

		return snapshotID;
	} catch (error) {
		await connection.query('ROLLBACK');
		throw error;
	} finally {
		Database.releaseConnection(connection);
	}
}

export async function DeleteSnapshot(snapshotID: SnapshotMetadata['id']) {
	const guildID = await ResolveGuildFromSnapshotID(snapshotID);

	const availableSnapshotIDs = (await ListSnapshotsForGuild(guildID)).map(x => x.id);
	if (!availableSnapshotIDs.includes(snapshotID)) throw new Error('Snapshot not found');

	const snapshot = (await GetSnapshot(snapshotID))!;
	if (snapshot.pinned) throw new Error('Cannot delete a pinned snapshot');

	const connection = await Database.getConnection();

	const promiseQueue = [];

	if (availableSnapshotIDs[availableSnapshotIDs.length - 1] === snapshotID) {
		// if this is the latest snapshot, delete the data immediately
		void connection.query(`
            DELETE
            FROM Snapshots
            WHERE id = ?
		`, [snapshotID]);
	} else {

		// merge data forward with next snapshot

		const tables = ['SnapshotRoles', 'SnapshotChannels', 'SnapshotPermissions', 'SnapshotBans'];

		const nextSnapshotID = availableSnapshotIDs[availableSnapshotIDs.indexOf(snapshotID) + 1];

		for (const table of tables) {
			promiseQueue.push(
				connection.query(`
                    DELETE
                    FROM ${table}
                    WHERE snapshot_id = ?
                      AND EXISTS (SELECT 1
                                  FROM ${table} AS next
                                  WHERE next.snapshot_id = ?
                                    AND next.id = ${table}.id)
				`, [snapshotID, nextSnapshotID]),

				connection.query(`
                    UPDATE ${table}
                    SET snapshot_id = ?
                    WHERE snapshot_id = ?
                      AND NOT EXISTS (SELECT 1
                                      FROM ${table} AS next
                                      WHERE next.snapshot_id = ?
                                        AND next.id = ${table}.id)
				`, [nextSnapshotID, snapshotID, nextSnapshotID]),

				connection.query(`
                    DELETE
                    FROM ${table}
                    WHERE snapshot_id = ?
				`, [snapshotID])
			);
		}

		promiseQueue.push(
			connection.query(`
                DELETE
                FROM Snapshots
                WHERE id = ?
			`, [snapshotID])
		);
	}

	// wait for everything to finish before releasing connection
	await Promise.all(promiseQueue);

	Database.releaseConnection(connection);
}


// reduced character set to help with confusion, ie O vs 0 or I vs l
const chars = 'ABCDEFGHKLMNPQRSTVWXYZ23456789';

async function GenerateExportID(connection: PoolConnection, attempts = 5): Promise<string> {
	if (attempts <= 0) throw new Error('Failed to generate snapshot ID');
	// XXXX-XXXX-XXXX-XXXX
	const id = [];
	for (let i = 0; i < 4; i++) {
		for (let j = 0; j < 4; j++) {
			id.push(chars[Math.floor(Math.random() * chars.length)]);
		}
		if (i !== 3) id.push('-');
	}
	const idString = id.join('');
	const exists = await connection.query('SELECT * FROM SnapshotExports WHERE id = ? LIMIT 1', [idString]).then(x => x[0]);
	return exists ? GenerateExportID(connection, attempts - 1) : idString;
}

export async function ExportSnapshot(snapshotID: SnapshotMetadata['id']): Promise<JSONSnapshot> {
	const snapshotData = await GetSnapshot(snapshotID);
	if (!snapshotData) throw new Error('Unknown snapshot ID');

	const connection = await Database.getConnection();
	const exportID = await GenerateExportID(connection).catch(() => null);
	if (!exportID) {
		Database.releaseConnection(connection);
		throw new Error('Failed to generate export ID');
	}

	const snapshotExport = {
		id         : exportID,
		version    : 2,
		type       : SNAPSHOT_TYPE.IMPORT,
		channels   : Array.from(snapshotData.channels.values()).map(x => Omit(x, ['snapshot_id', 'deleted'])),
		roles      : Array.from(snapshotData.roles.values()).map(x => Omit(x, ['snapshot_id', 'deleted'])),
		bans       : Array.from(snapshotData.bans.values()).map(x => Omit(x, ['snapshot_id', 'deleted']))
	}

	Database.releaseConnection(connection);
	return snapshotExport;
}

export async function isSnapshotQueuedForDeletion(snapshotID: SnapshotMetadata['id']) {
	const guildID = await ResolveGuildFromSnapshotID(snapshotID);

	const maxSnapshotCount = await MaxSnapshotsForGuild(guildID);

	const availableSnapshots = await ListSnapshotsForGuild(guildID);
	if (availableSnapshots.length <= maxSnapshotCount) return false; // not enough snapshots to delete

	// we only have to check the last snapshots because anything before will stay no matter what
	for (let i = maxSnapshotCount; i < availableSnapshots.length; i++) {
		const snapshot = availableSnapshots[i];
		if (snapshot.id === snapshotID) {
			return !snapshot.pinned; // can only delete if not pinned
		}
	}

	return false;
}

export async function IsSnapshotDeletable(snapshotID: SnapshotMetadata['id']) {
	const snapshot = await GetSnapshot(snapshotID);
	if (!snapshot) return false;
	return !snapshot.pinned;
}

const guildCache = new Map<SnapshotMetadata['id'], SnapshotMetadata['guild_id']>(); // snapshotID -> guildID
async function ResolveGuildFromSnapshotID(snapshotID: SnapshotMetadata['id']) {
	if (guildCache.has(snapshotID)) return guildCache.get(snapshotID)!;

	const guildID = await Database.query(`
        SELECT *
        FROM Snapshots
        WHERE id = ?
	`, [snapshotID]).then(rows => rows[0]?.guild_id) as SnapshotMetadata['guild_id'] | null;
	if (!guildID) throw new Error('Snapshot not found');

	guildCache.set(snapshotID, guildID);
	return guildID;
}

export async function MaxSnapshotsForGuild(guildID: SimpleGuild['id'] | Guild['id']) {
	// database stuff later lol
	return 7;
}

export async function SetSnapshotPinStatus(snapshotID: SnapshotMetadata['id'], pinned: boolean) {
	const guildID = await ResolveGuildFromSnapshotID(snapshotID);
	const snapshots = await ListSnapshotsForGuild(guildID);
	const pinCount = snapshots.reduce((acc, snapshot) => acc + snapshot.pinned, 0);
	const maxSnapshots = await MaxSnapshotsForGuild(guildID);
	if (pinCount >= maxSnapshots) throw new Error('Cannot pin snapshot - Slots are already full');

	await Database.query(`
        UPDATE Snapshots
        SET pinned = ?
        WHERE id = ?
	`, [pinned, snapshotID]);
}