const { Guild, GuildChannel, Role, GuildBan, PermissionOverwrites } = require('discord.js');
const crypto = require('crypto');
const Database = require('./Database');
const Log = require('./Logs');
const { SNAPSHOT_TYPE, SECONDS } = require('./Constants');
const client = require('../client.js');
const TTLCache = require('./Caching/TTLCache.js');

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

function PermKey(channelID, roleID) {
	return `${channelID}-${roleID}`;
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

	if (typeof channel.id !== 'string' || channel.id.length === 0) {
		throw new Error('Channel ID must be a non-empty string');
	}

	return {
		id: channel.id,
		type: channel.type ?? 0,
		name: channel.name ?? 'Unknown',
		position: channel.position ?? 0,
		topic: channel.topic ?? null,
		nsfw: channel.nsfw ? 1 : 0,
		parent_id: channel.parent_id ?? null
	}
}

function SimplifyRole(role) {
	if (role instanceof Role) return {
		id: role.id,
		name: role.name,
		color: role.color,
		hoist: +role.hoist || 0,
		position: role.rawPosition,
		permissions: String(role.permissions.bitfield),
		managed: +role.managed || 0
	}

	if (typeof role.id !== 'string' || role.id.length === 0) {
		throw new Error('Role ID must be a non-empty string');
	}

	return {
		id: role.id,
		name: role.name ?? 'Unknown',
		color: role.color ?? 0,
		hoist: +role.hoist || 0,
		position: role.position ?? 0,
		permissions: role.permissions ?? '0',
		managed: +role.managed || 0
	}
}

function SimplifyPermission(channelID, permission) {
	if (permission instanceof PermissionOverwrites) return {
		id: PermKey(channelID, permission.id),
		channel_id: channelID,
		role_id: permission.id,
		allow: permission.allow.bitfield,
		deny: permission.deny.bitfield,
	}

	if (typeof channelID !== 'string' || channelID.length === 0) {
		throw new Error('Channel ID must be a non-empty string');
	}

	if (typeof permission.role_id !== 'string' || permission.role_id.length === 0) {
		throw new Error('Role ID must be a non-empty string');
	}

	return {
		id: PermKey(channelID, permission.role_id),
		channel_id: channelID,
		role_id: permission.role_id,
		allow: permission.allow ?? 0n,
		deny: permission.deny ?? 0n
	}
}

function SimplifyBan(ban) {
	if (ban instanceof GuildBan) return {
		user_id: ban.user.id,
		reason: ban.reason ?? 'No reason provided',
	}

	if (typeof ban.user_id !== 'string' || ban.user_id.length === 0) {
		throw new Error('User ID must be a non-empty string');
	}

	return {
		user_id: ban.user_id,
		reason: ban.reason ?? 'No reason provided',
	}
}


const statCache = new TTLCache();
const stateCache = new TTLCache();

function SnapshotStats(snapshotID) {
	if (statCache.has(snapshotID)) return statCache.get(snapshotID);

	const guildID = ResolveGuildFromSnapshot(snapshotID);

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
		}, SECONDS.HOUR * 1000); // cache for 1 hour
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

	statCache.set(snapshotID, stats, SECONDS.HOUR * 1000); // cache for 1 hour
	return stats;
}


const snapshotCache = new TTLCache(); // 1 hour
function FetchSnapshot(snapshot_id, { cache = true } = {}) {
	if (cache && snapshotCache.has(snapshot_id)) return snapshotCache.get(snapshot_id);

	const guildID = ResolveGuildFromSnapshot(snapshot_id);

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
		`).safeIntegers().all(snapshotID);
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

	if (cache) snapshotCache.set(snapshot_id, result, SECONDS.HOUR * 1000); // cache for 1 hour
	return result;
}

const banCache = new TTLCache(); // guild_id -> Map<userID, GuildBan>
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
			bans.set(userID, { user_id: userID, reason: ban.reason ?? 'No reason provided' });
		}

		offset = fetchedBans.last()?.user.id;
		if (!offset || offset === previousOffset) {
			console.warn('Pagination halted: offset is stuck or undefined.');
			break;
		}
		previousOffset = offset;

		if (fetchedBans.size < MAX_BANS) break;
	}

	banCache.set(guild.id, bans, SECONDS.HOUR * 1000); // cache for 1 hour
	return bans;
}


const CHANGE_TYPE = {
	CREATE: 0,
	UPDATE: 1,
	DELETE: 2
}

const ALLOWED_CHANNEL_TYPES = new Set([0, 2, 4, 5, 10, 13, 15, 16]);

async function CreateSnapshot(guild, type = SNAPSHOT_TYPE.AUTOMATIC) {
	if (!(guild instanceof Guild)) throw new Error('Expected argument to be a Guild instance');
	if (!Object.values(SNAPSHOT_TYPE).includes(type)) throw new Error('Invalid snapshot type, must be within SNAPSHOT_TYPE enum');

	const botMember = guild.members.cache.get(client.user.id) ?? await guild.members.fetch(client.user.id).catch(() => null);
	if (!botMember) {
		Log.error(`[SNAPSHOT] Bot is not a member of the guild ${guild.name} (${guild.id})`);
		return null;
	}

	const botRole = guild.roles.cache.find(role => role.tags?.botId === client.user.id);
	if (!botRole) {
		Log.error(`[SNAPSHOT] Bot role not found in guild ${guild.name} (${guild.id})`);
		return null;
	}

	const fetchStart = process.hrtime.bigint();
	if (!botMember.permissions.has('BanMembers')) {
		Log.error(`[SNAPSHOT] Bot does not have BanMembers permission in guild ${guild.name} (${guild.id}), skipping bans fetch`);
		var currentBans = new Map();
	} else {
		// Fetch all bans, this can take a while
		try {
			var currentBans = await FetchAllBans(guild);
		} catch (error) {
			Log.error(`[SNAPSHOT] Failed to fetch bans for guild ${guild.name} (${guild.id}): ${error.message}`);
			var currentBans = new Map();
		}
	}

	const channels = []; // { change_type, ... data }[];
	const roles = [];
	const permissions = [];
	const bans = [];

	const guildRoles = Array.from(guild.roles.cache.values());
	const guildChannels = Array.from(guild.channels.cache.values());
	const guildBans = Array.from(currentBans.values());

	const fetchEnd = process.hrtime.bigint();

	const diffStart = process.hrtime.bigint();

	const highestRole = guild.roles.highest;
	if (botRole.rawPosition < highestRole.rawPosition) {
		// bot role is not at the top, move everything above it down
		for (const role of guildRoles) {
			if (role.id === botRole.id) {
				role.rawPosition = highestRole.rawPosition + 1; // move bot role to the top
				continue;
			}
		}
	}

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
			AddItem(role, roles, SimplifyRole);
		}

		for (const channel of guildChannels) {
			if (!ALLOWED_CHANNEL_TYPES.has(channel.type)) continue; // skip non-guild channels
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
			if (!ALLOWED_CHANNEL_TYPES.has(channel.type)) continue; // skip non-guild channels
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
					processedPerms.add(simplePermission.id);
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
			if (role.managed) continue; // cant delete a bot role lol
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
	const diffEnd = process.hrtime.bigint();

	let dbStart, dbEnd;

	Database.transaction(async () => {
		dbStart = process.hrtime.bigint();
		const snapshotID = Database.prepare(`
			INSERT INTO Snapshots (guild_id, type)
			VALUES (?, ?)
		`).run(guild.id, type).lastInsertRowid;

		for (const role of roles) {
			Database.prepare(`
				INSERT INTO SnapshotRoles (snapshot_id, id, name, color, hoist, position, permissions, managed, hash, deleted)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
			`).run(snapshotID, role.id, role.name, role.color, role.hoist, role.position, role.permissions, role.managed ? 1 : 0, role.hash, role.change_type === CHANGE_TYPE.DELETE ? 1 : 0);
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
		dbEnd = process.hrtime.bigint();
	})();

	const banDuration = Number(fetchEnd - fetchStart) / 1e6;
	const diffDuration = Number(diffEnd - diffStart) / 1e6;
	const dbDuration = Number(dbEnd - dbStart) / 1e6;

	const snapshotID = Database.prepare(`
		SELECT MAX(id)
		FROM Snapshots
		WHERE guild_id = ?
	`).pluck().get(guild.id) ?? 0;
	Log.custom(`Snapshot #${snapshotID} created for ${guild.name} (${guild.id})`, 0x7946ff);
	Log.custom(`Fetching : ${banDuration.toFixed(2)}ms, Diffing : ${diffDuration.toFixed(2)}ms, DB : ${dbDuration.toFixed(2)}ms`, 0x7946ff);

	return snapshotID;
}

function DeleteSnapshot(snapshotID) {
	const guildID = ResolveGuildFromSnapshot(snapshotID);

	const availableSnapshots = Database.prepare(`
		SELECT id
		FROM Snapshots
		WHERE guild_id = ?
		ORDER BY id ASC
	`).pluck().all(guildID) ?? [];
	if (!availableSnapshots.includes(snapshotID)) throw new Error('Snapshot not found');

	const tables = [
		{
			name: 'SnapshotRoles',
			idColumn: 'id'
		},
		{
			name: 'SnapshotChannels',
			idColumn: 'id'
		},
		{
			name: 'SnapshotPermissions',
			idColumn: 'id'
		},
		{
			name: 'SnapshotBans',
			idColumn: 'user_id'
		}
	]

	if (availableSnapshots[availableSnapshots.length - 1] === snapshotID) {
		// if this is the latest snapshot, delete the data immediately
		Database.prepare(`
			DELETE FROM Snapshots
			WHERE id = ?
		`).run(snapshotID);
		for (const table of tables) {
			Database.prepare(`
				DELETE FROM ${table.name}
				WHERE snapshot_id = ?
			`).run(snapshotID);
		}
	} else {

		// merge data forward with next snapshot

		const nextSnapshotID = availableSnapshots[availableSnapshots.indexOf(snapshotID) + 1];

		for (const table of tables) {
			if (!Database.tables.has(table.name)) {
				throw new Error(`Table "${table.name}" does not exist in the database`);
			}
			Database.prepare(`
				DELETE FROM ${table.name}
				WHERE snapshot_id = ?
				AND EXISTS (
					SELECT 1
					FROM ${table.name} AS next
					WHERE next.snapshot_id = ?
					AND next.${table.idColumn} = ${table.name}.${table.idColumn}
				)
			`).run(snapshotID, nextSnapshotID);
			Database.prepare(`
				UPDATE ${table.name}
				SET snapshot_id = ?
				WHERE snapshot_id = ?
				AND NOT EXISTS (
					SELECT 1
					FROM ${table.name} AS next
					WHERE next.snapshot_id = ?
					AND next.${table.idColumn} = ${table.name}.${table.idColumn}
				)
			`).run(nextSnapshotID, snapshotID, nextSnapshotID);
			Database.prepare(`
				DELETE FROM ${table.name}
				WHERE snapshot_id = ?
			`).run(snapshotID);
		}

		Database.prepare(`
			DELETE FROM Snapshots
			WHERE id = ?
		`).run(snapshotID);
	}
}


async function UpdateHashes(snapshotID) {
	const snapshotData = FetchSnapshot(snapshotID, { cache: false });
	if (!snapshotData) return;

	const Update = (lookup, table, id, simplify) => {
		const itemsNeedingUpdate = Database.prepare(`
			SELECT *
			FROM ${table}
			WHERE snapshot_id = ?
			AND needsUpdate = 1
		`).all(snapshotID);

		for (const item of itemsNeedingUpdate) {

			if (!lookup.has(item[id])) {
				Log.error(`Item with ID ${item[id]} not found in lookup for table ${table}`);
				continue;
			}

			const simplified = simplify(item);
			const hash = HashObject(simplified);

			const savedItem = lookup.get(simplified[id]);

			if (savedItem.hash !== hash) {
				Database.prepare(`
					UPDATE ${table}
					SET hash = ?, needsUpdate = 0
					WHERE snapshot_id = ?
					AND ${id} = ?
				`).run(hash, snapshotID, simplified[id]);
			}
		}
	}

	Update(snapshotData.roles, 'SnapshotRoles', 'id', SimplifyRole);
	Update(snapshotData.channels, 'SnapshotChannels', 'id', SimplifyChannel);
	Update(snapshotData.permissions, 'SnapshotPermissions', 'id', (permission) => SimplifyPermission(permission.channel_id, permission));
}

const chars = 'ABCDEFGHKLMNPQRSTVWXYZ23456789';
function GenerateExportID(attempts = 5) {
	if (attempts <= 0) throw new Error('Failed to generate snapshot ID');
	// XXXX-XXXX-XXXX-XXXX
	const id = [];
	for (let i = 0; i < 4; i++) {
		for (let j = 0; j < 4; j++) {
			id.push( chars[Math.floor(Math.random() * chars.length)] );
		}
		if (i !== 3) id.push('-');
	}
	const idString = id.join('');
	const exists = Database.prepare('SELECT * FROM SnapshotExports WHERE id = ?').get(idString);
	return exists ? GenerateExportID(attempts - 1) : idString;
}

const SNAPSHOT_VERSION = 1;

function ExportSnapshot(snapshotID) {
	const snapshotData = FetchSnapshot(snapshotID);
	if (!snapshotData) return null;

	return {
		id: GenerateExportID(),
		version: SNAPSHOT_VERSION,
		channels: Array.from(snapshotData.channels.values()),
		roles: Array.from(snapshotData.roles.values()),
		permissions: Array.from(snapshotData.permissions.values()),
		bans: Array.from(snapshotData.bans.values())
	};
}

const CACHE_TYPE = {
	STAT : 1 << 0,
	STATE: 1 << 1,
	SNAPSHOT: 1 << 2,
	BAN: 1 << 3,
}

const ALL_CACHE = Object.values(CACHE_TYPE).reduce((acc, val) => acc | val, 0);

function ClearCache(snapshotID, type = ALL_CACHE) {
	if (type & CACHE_TYPE.STAT		) statCache.delete(snapshotID);
	if (type & CACHE_TYPE.STATE		) stateCache.delete(snapshotID);
	if (type & CACHE_TYPE.SNAPSHOT	) snapshotCache.delete(snapshotID);
	if (type & CACHE_TYPE.BAN		) banCache.delete(snapshotID);
}

function isSnapshotDeletable(snapshotID) {
	const guildID = ResolveGuildFromSnapshot(snapshotID);

	const snapshotCount = MaxSnapshots(guildID);

	const availableSnapshots = Database.prepare(`
		SELECT id, pinned
		FROM Snapshots
		WHERE guild_id = ?
		ORDER BY pinned DESC, id DESC
	`).all(guildID) ?? [];
	if (availableSnapshots.length <= snapshotCount) return false; // not enough snapshots to delete

	// we only have to check the last snapshots because anything before will stay no matter what
	for (let i = snapshotCount; i < availableSnapshots.length; i++) {
		const snapshot = availableSnapshots[i];
		if (snapshot.id === snapshotID) {
			return snapshot.pinned === 0; // can only delete if not pinned
		}
	}

	return false;
}

const guildCache = new TTLCache(); // snapshotID -> guildID
function ResolveGuildFromSnapshot(snapshotID) {
	if (guildCache.has(snapshotID)) return guildCache.get(snapshotID);

	const guildID = Database.prepare(`
		SELECT guild_id
		FROM Snapshots
		WHERE id = ?
	`).pluck().get(snapshotID);
	if (!guildID) throw new Error('Snapshot not found');

	guildCache.set(snapshotID, guildID, SECONDS.HOUR * 6 * 1000); // cache for 6 hours
	return guildID;
}

function MaxSnapshots(guildID) {
	// database stuff later lol
	return 7;
}

module.exports = {
	SimplifyChannel,
	SimplifyRole,
	SimplifyPermission,
	SimplifyBan,

	CreateSnapshot,
	DeleteSnapshot,
	FetchSnapshot,
	SnapshotStats,
	UpdateHashes,
	ExportSnapshot,

	HashObject,
	PermKey,
	FetchAllBans,

	isSnapshotDeletable,
	MaxSnapshots,

	SNAPSHOT_TYPE,
	CHANGE_TYPE,
	ALLOWED_CHANNEL_TYPES,

	ClearCache,
	CACHE_TYPE,
};