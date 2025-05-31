const { Guild, GuildChannel, Role, GuildBan, PermissionOverwrites } = require('discord.js');
const crypto = require('crypto');
const Database = require('./Database');
const TimedCache = require('./Caching/TimedCache');
const Log = require('./Logs');
const { SNAPSHOT_TYPE } = require('./Constants');

function HashObject(obj) {
	if (Object.values(obj).some(v => typeof v === 'object' && v !== null)) {
		console.log(obj);
		throw new Error('HashObject received a nested object. Use only on flattened structures.');
	}

	const entries = Object.entries(obj);
	entries.sort(([keyA], [keyB]) => keyA.localeCompare(keyB));
	const flatString = entries.map(([key, value]) => key + ':' + value).join(',');
	return crypto.createHash('sha1').update(flatString).digest('hex');
}

function SimplifyChannel(channel) {
	if (channel instanceof GuildChannel) return {
		id: channel.id,
		type: channel.type,
		name: channel.name,
		position: channel.rawPosition,
		topic: channel.topic ?? null,
		nsfw: channel.nsfw ? 1 : 0,
		parent_id: channel.parentId ?? null
	}

	return {
		id: channel.id,
		type: channel.type,
		name: channel.name,
		position: channel.position,
		topic: channel.topic,
		nsfw: channel.nsfw,
		parent_id: channel.parent_id
	}
}

function SimplifyRole(role) {
	if (role instanceof Role) return {
		id: role.id,
		name: role.name,
		color: role.color,
		hoist: +role.hoist,
		position: role.position,
		permissions: String(role.permissions.bitfield)
	}

	return {
		id: role.id,
		name: role.name,
		color: role.color,
		hoist: +role.hoist,
		position: role.position,
		permissions: role.permissions
	}
}

function SimplifyPermission(channelID, permission) {
	if (permission instanceof PermissionOverwrites) return {
		id: channelID + '-' + permission.id,
		channel_id: channelID,
		role_id: permission.id,
		allow: permission.allow.bitfield,
		deny: permission.deny.bitfield,
	}

	return {
		id: channelID + '-' + permission.role_id,
		channel_id: channelID,
		role_id: permission.role_id,
		allow: permission.allow,
		deny: permission.deny,
	}
}

function SimplifyBan(ban) {
	if (ban instanceof GuildBan) return {
		user_id: ban.user.id,
		reason: ban.reason,
	}

	return {
		user_id: ban.user_id,
		reason: ban.reason,
	}
}


const statCache = new TimedCache(1000 * 60 * 60); // 1 hour
const stateCache = new TimedCache(1000 * 60 * 60); // cache full sets per snapshot too

function SnapshotStats(snapshotID) {
	if (statCache.has(snapshotID)) return statCache.get(snapshotID);

	const guildID = Database.prepare(`
		SELECT guild_id
		FROM snapshots
		WHERE id = ?
	`).pluck().get(snapshotID);
	if (!guildID) throw new Error('Snapshot not found');

	const snapshotIDs = Database.prepare(`
		SELECT id
		FROM Snapshots
		WHERE guild_id = ?
		ORDER BY id ASC
	`).pluck().all(guildID);
	if (!snapshotIDs.includes(snapshotID)) throw new Error('Snapshot not found');

	const targetIndex = snapshotIDs.indexOf(snapshotID);

	// Start state from closest cached snapshot, or from empty
	let baseState = {
		channels: new Set(),
		roles: new Set(),
		permissions: new Set(),
		bans: new Set(),
	};
	let baseIndex = -1;

	for (let i = targetIndex - 1; i >= 0; i--) {
		const cachedID = snapshotIDs[i];
		if (stateCache.has(cachedID)) {
			const cached = stateCache.get(cachedID);
			baseState = {
				channels: new Set(cached.channels),
				roles: new Set(cached.roles),
				permissions: new Set(cached.permissions),
				bans: new Set(cached.bans),
			};
			baseIndex = i;
			break;
		}
	}

	for (let i = baseIndex + 1; i <= targetIndex; i++) {
		const sid = snapshotIDs[i];

		const updateSet = (table, set, idKey = 'id') => {
			const rows = Database.prepare(`SELECT ${idKey}, deleted FROM ${table} WHERE snapshot_id = ?`).all(sid);
			for (const row of rows) {
				if (row.deleted) set.delete(row[idKey]);
				else set.add(row[idKey]);
			}
		};

		updateSet('SnapshotChannels', baseState.channels);
		updateSet('SnapshotRoles', baseState.roles);
		updateSet('SnapshotPermissions', baseState.permissions);
		updateSet('SnapshotBans', baseState.bans, 'user_id');

		// Cache state at this point
		stateCache.set(sid, {
			channels: new Set(baseState.channels),
			roles: new Set(baseState.roles),
			permissions: new Set(baseState.permissions),
			bans: new Set(baseState.bans),
		});
	}

	const metadata = Database.prepare(`
		SELECT *
		FROM Snapshots
		WHERE id = ?
	`).get(snapshotID);

	const stats = {
		...metadata,
		channels: baseState.channels.size,
		roles: baseState.roles.size,
		permissions: baseState.permissions.size,
		bans: baseState.bans.size
	};

	statCache.set(snapshotID, stats);
	return stats;
}


const snapshotCache = new TimedCache(1000 * 60 * 60); // 1 hour
function FetchSnapshot(snapshot_id) {
	if (snapshotCache.has(snapshot_id)) return snapshotCache.get(snapshot_id);

	const guildID = Database.prepare('SELECT guild_id FROM snapshots WHERE id = ?').pluck().get(snapshot_id);
	if (!guildID) throw new Error('Snapshot not found');

	const availableSnapshots = Database.prepare(`
		SELECT id
		FROM snapshots
		WHERE guild_id = ?
		ORDER BY id ASC
	`).pluck().all(guildID) ?? [];
	if (!availableSnapshots.includes(snapshot_id)) throw new Error('Snapshot not found');

	const roles = new Map();
	const channels = new Map();
	const permissions = new Map();
	const bans = new Map();

	for (const snapshotID of availableSnapshots) {
		if (snapshotID > snapshot_id) break; // done reading snapshot data

		const snapshotRoles = Database.prepare(`
			SELECT *
			FROM SnapshotRoles
			WHERE snapshot_id = ?
		`).all(snapshotID);
		for (const role of snapshotRoles) {
			if (role.deleted) {
				roles.delete(role.id);
				continue;
			}
			roles.set(role.id, role);
		}

		const snapshotChannels = Database.prepare(`
			SELECT *
			FROM SnapshotChannels
			WHERE snapshot_id = ?
		`).all(snapshotID);
		for (const channel of snapshotChannels) {
			if (channel.deleted) {
				channels.delete(channel.id);
				continue;
			}
			channels.set(channel.id, channel);
		}

		const snapshotPermissions = Database.prepare(`
			SELECT *
			FROM SnapshotPermissions
			WHERE snapshot_id = ?
		`).all(snapshotID);
		for (const permission of snapshotPermissions) {
			if (permission.deleted) {
				permissions.delete(permission.id);
				continue;
			}
			permissions.set(permission.id, permission);
		}

		const snapshotBans = Database.prepare(`
			SELECT *
			FROM SnapshotBans
			WHERE snapshot_id = ?
		`).all(snapshotID);
		for (const ban of snapshotBans) {
			if (ban.deleted) {
				bans.delete(ban.id);
				continue;
			}
			bans.set(ban.user_id, ban);
		}
	}

	const snapshotMetadata = Database.prepare(`
		SELECT *
		FROM Snapshots
		WHERE id = ?
	`).get(snapshot_id);

	const result = {
		...snapshotMetadata,
		channels: channels,
		roles: roles,
		permissions: permissions,
		bans: bans
	}

	snapshotCache.set(snapshot_id, result);
	return result;
}

const banCache = new TimedCache(1000 * 60 * 60); // 1 hour

async function FetchAllBans(guild) {
	if (!(guild instanceof Guild)) throw new Error('Expected argument to be a Guild instance');
	if (banCache.has(guild.id)) return banCache.get(guild.id);

	const MAX_BANS = 1000;
	const bans = new Map();

	let offset;
	let previousOffset;

	while (true) {
		const fetchedBans = await guild.bans.fetch({ limit: MAX_BANS, after: offset });

		if (fetchedBans.size === 0) break;

		for (const [userID, ban] of fetchedBans) {
			bans.set(userID, ban);
		}

		offset = fetchedBans.last()?.user.id;
		if (!offset || offset === previousOffset) {
			console.warn('Pagination halted: offset is stuck or undefined.');
			break;
		}
		previousOffset = offset;

		if (fetchedBans.size < MAX_BANS) break;
	}

	banCache.set(guild.id, bans);
	return bans;
}


const CHANGE_TYPE = {
	CREATE: 0,
	UPDATE: 1,
	DELETE: 2
}

const allowedChannelTypes = new Set([ 0, 2, 4, 5, 10, 13, 15, 16 ]);

async function CreateSnapshot(guild, type = 0) {
	if (!(guild instanceof Guild)) throw new Error('Expected argument to be a Guild instance');
	if (!Object.values(SNAPSHOT_TYPE).includes(type)) throw new Error('Invalid snapshot type, must be within SNAPSHOT_TYPE enum');

	const start = process.hrtime.bigint();

	const channels = []; // { change_type, ... data }[];
	const roles = [];
	const permissions = [];
	const bans = [];

	const guildRoles = Array.from(guild.roles.cache.values());
	const guildChannels = Array.from(guild.channels.cache.values());
	const guildBans = Array.from((await FetchAllBans(guild)).values());

	const latestSnapshotID = Database.prepare(`
		SELECT MAX(id)
		FROM Snapshots
		WHERE guild_id = ?
	`).pluck().get(guild.id) ?? 0;

	const lastSnapshot = Database.prepare(`
		SELECT *
		FROM Snapshots
		WHERE id = ?
	`).get(latestSnapshotID);
	if (!lastSnapshot) {

		function AddItem(item, arr, simplyFunc) {
			const simpleItem = simplyFunc(item);
			const hash = HashObject(simpleItem);
			arr.push({
				change_type: CHANGE_TYPE.CREATE,
				hash: hash,
				...simpleItem
			});
		}

		// first snapshot, no checks needed
		for (const role of guildRoles) {
			if (role.managed) continue; // skip roles from bots
			AddItem(role, roles, SimplifyRole);
		}

		for (const channel of guildChannels) {
			if (!allowedChannelTypes.has(channel.type)) continue; // skip non-guild channels
			AddItem(channel, channels, SimplifyChannel);

			if (channel.permissionOverwrites) {
				for (const permission of channel.permissionOverwrites.cache.values()) {
					if (permission.allow.bitfield === 0n && permission.deny.bitfield === 0n) continue; // default permissions, save storage lol
					AddItem(permission, permissions, SimplifyPermission.bind(null, channel.id));
				}
			}

		}

		for (const ban of guildBans) {
			AddItem(ban, bans, SimplifyBan);
		}
	} else {

		const snapshotData = FetchSnapshot(latestSnapshotID);

		const processedRoles = new Set();
		const processedChannels = new Set();
		const processedPerms = new Set();
		const processedBans = new Set();

		for (const role of guildRoles) {
			if (role.managed) continue; // skip roles from bots
			const simpleRole = SimplifyRole(role);
			const hash = HashObject(simpleRole);
			processedRoles.add(role.id);
			if (snapshotData.roles.has(simpleRole.id)) {
				if (snapshotData.roles.get(simpleRole.id).hash !== hash) {
					roles.push({
						change_type: CHANGE_TYPE.UPDATE,
						hash: hash,
						...simpleRole
					});
				}
			} else {
				roles.push({
					change_type: CHANGE_TYPE.CREATE,
					hash: hash,
					...simpleRole
				});
			}
		}

		for (const channel of guildChannels) {
			if (!allowedChannelTypes.has(channel.type)) continue; // skip non-guild channels
			const simpleChannel = SimplifyChannel(channel);
			const hash = HashObject(simpleChannel);
			processedChannels.add(channel.id);
			if (snapshotData.channels.has(simpleChannel.id)) {
				if (snapshotData.channels.get(simpleChannel.id).hash !== hash) {
					channels.push({
						change_type: CHANGE_TYPE.UPDATE,
						hash: hash,
						...simpleChannel
					});
				}
			} else {
				channels.push({
					change_type: CHANGE_TYPE.CREATE,
					hash: hash,
					...simpleChannel
				});
			}

			if (channel.permissionOverwrites) {
				for (const permission of channel.permissionOverwrites.cache.values()) {
					if (permission.allow.bitfield === 0n && permission.deny.bitfield === 0n) continue; // default permissions, save storage lol
					const simplePermission = SimplifyPermission(channel.id, permission);
					const hash = HashObject(simplePermission);
					processedPerms.add(`${simplePermission.channel_id}-${simplePermission.role_id}`);
					if (snapshotData.permissions.has(simplePermission.id)) {
						if (snapshotData.permissions.get(simplePermission.id).hash !== hash) {
							permissions.push({
								change_type: CHANGE_TYPE.UPDATE,
								hash: hash,
								...simplePermission
							});
						}
					} else {
						permissions.push({
							change_type: CHANGE_TYPE.CREATE,
							hash: hash,
							...simplePermission
						});
					}
				}
			}
		}

		for (const ban of guildBans) {
			const simpleBan = SimplifyBan(ban);
			const hash = HashObject(simpleBan);
			processedBans.add(ban.user.id);
			if (snapshotData.bans.has(simpleBan.user_id)) {
				if (snapshotData.bans.get(simpleBan.user_id).hash !== hash) {
					bans.push({
						change_type: CHANGE_TYPE.UPDATE,
						hash: hash,
						...simpleBan
					});
				}
			} else {
				bans.push({
					change_type: CHANGE_TYPE.CREATE,
					hash: hash,
					...simpleBan
				});
			}
		}

		for (const role of snapshotData.roles.keys()) {
			if (!processedRoles.has(role)) {
				roles.push({
					change_type: CHANGE_TYPE.DELETE,
					...snapshotData.roles.get(role)
				});
			}
		}

		for (const channel of snapshotData.channels.keys()) {
			if (!processedChannels.has(channel)) {
				channels.push({
					change_type: CHANGE_TYPE.DELETE,
					...snapshotData.channels.get(channel)
				});
			}
		}

		for (const permission of snapshotData.permissions.keys()) {
			if (!processedPerms.has(permission)) {
				permissions.push({
					change_type: CHANGE_TYPE.DELETE,
					...snapshotData.permissions.get(permission)
				});
			}
		}

		for (const ban of snapshotData.bans.keys()) {
			if (!processedBans.has(ban)) {
				bans.push({
					change_type: CHANGE_TYPE.DELETE,
					...snapshotData.bans.get(ban)
				});
			}
		}
	}

	Database.transaction(() => {
		const snapshotID = Database.prepare(`
			INSERT INTO Snapshots (guild_id, type)
			VALUES (?, ?)
		`).run(guild.id, type).lastInsertRowid;

		for (const role of roles) {
			Database.prepare(`
				INSERT INTO SnapshotRoles (snapshot_id, id, name, color, hoist, position, permissions, hash, deleted)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
			`).run(snapshotID, role.id, role.name, role.color, role.hoist, role.position, role.permissions, role.hash, role.change_type === CHANGE_TYPE.DELETE ? 1 : 0);
		}
		for (const channel of channels) {
			Database.prepare(`
				INSERT INTO SnapshotChannels (snapshot_id, id, type, name, position, topic, nsfw, parent_id, hash, deleted)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
			`).run(snapshotID, channel.id, channel.type, channel.name, channel.position, channel.topic, channel.nsfw, channel.parent_id, channel.hash, channel.change_type === CHANGE_TYPE.DELETE ? 1 : 0);
		}
		for (const permission of permissions) {
			Database.prepare(`
				INSERT INTO SnapshotPermissions (snapshot_id, channel_id, role_id, allow, deny, hash, deleted)
				VALUES (?, ?, ?, ?, ?, ?, ?)
			`).run(snapshotID, permission.channel_id, permission.role_id, permission.allow, permission.deny, permission.hash, permission.change_type === CHANGE_TYPE.DELETE ? 1 : 0);
		}
		for (const ban of bans) {
			Database.prepare(`
				INSERT INTO SnapshotBans (snapshot_id, user_id, reason, hash, deleted)
				VALUES (?, ?, ?, ?, ?)
			`).run(snapshotID, ban.user_id, ban.reason, ban.hash, ban.change_type === CHANGE_TYPE.DELETE ? 1 : 0);
		}
	})();

	const end = process.hrtime.bigint();
	const duration = Number(end - start) / 1e6;
	const snapshotID = Database.prepare(`
		SELECT MAX(id)
		FROM Snapshots
		WHERE guild_id = ?
	`).pluck().get(guild.id) ?? 0;
	Log.custom(`Snapshot #${snapshotID} created for ${guild.name} (${guild.id}) in ${~~duration}ms`, 0x7946ff);

	return snapshotID;
}

module.exports = {
	SimplifyChannel,
	SimplifyRole,
	SimplifyPermission,
	SimplifyBan,

	CreateSnapshot,
	FetchSnapshot,
	SnapshotStats,

	HashObject,
	FetchAllBans,

	SNAPSHOT_TYPE,
	CHANGE_TYPE
};